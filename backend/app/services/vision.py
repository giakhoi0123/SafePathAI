"""
Computer Vision Pipeline for SafePathAI.
Combines OpenCV image preprocessing, real ONNX YOLOv5 vehicle detection,
ONNX flood water segmentation, and provenance-tracked visual evidence overlays.

Zero-Mock Implementation:
- Real ONNX InferenceSession using verified YOLOv5n model weights (SHA-256 verified).
- No heuristic fallback disguised as AI/YOLO.
- Transparent MODEL_UNAVAILABLE reporting when weights are missing.
- Strict separation of vehicle count (snapshot observation) vs traffic flow/speed.
- Strict separation of flood ratio (pixel ratio in ROI) vs water depth in cm.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
import os
import shutil
from typing import Any, Dict, List, Optional, Tuple, Union
import cv2
import numpy as np
from redis.asyncio import Redis

from backend.app.core.config import settings
from backend.app.db.session import get_redis_client
from backend.app.schemas.contracts import (
    CameraEvidence,
    DataSourceStatus,
    EvidenceEligibility,
    ImageAccessStatus,
    RiskLevel,
)

logger = logging.getLogger(__name__)

# Standard vehicle class weights for traffic density calculation
VEHICLE_WEIGHTS: Dict[str, float] = {
    "motorcycle": 1.0,
    "car": 2.5,
    "bus": 4.0,
    "truck": 4.0,
}

# COCO 80 classes mapping for vehicle categories
COCO_VEHICLE_CLASSES = {
    2: ("car", 2.5),
    3: ("motorcycle", 1.0),
    5: ("bus", 4.0),
    7: ("truck", 4.0),
}

# Saturation capacity units for a standard 300x230 camera frame in HCMC
DENSITY_SATURATION_WEIGHT: float = 45.0

# Risk classification thresholds (based on observed pixel ratios and density)
CRITICAL_FLOOD_RATIO = 0.25
MODERATE_FLOOD_RATIO = 0.10
CRITICAL_TRAFFIC_DENSITY = 0.85
MODERATE_TRAFFIC_DENSITY = 0.50

DEFAULT_YOLO_PATH = "data/models/yolov5n.onnx"
DEFAULT_FLOOD_UNET_PATH = "data/models/flood_unet.onnx"
DEFAULT_MANIFEST_PATH = "data/models/model_manifest.json"


def verified_model_manifest_entry(model_key: str, model_path: str) -> Optional[Dict[str, Any]]:
    """Reject missing, unlisted, modified, or unvalidated model weights before ONNX load."""
    try:
        with open(DEFAULT_MANIFEST_PATH, encoding="utf-8") as manifest_file:
            entry = json.load(manifest_file)["models"][model_key]
        expected_hash = entry.get("sha256")
        if not isinstance(expected_hash, str) or len(expected_hash) != 64:
            return None
        if os.path.realpath(model_path) != os.path.realpath(entry["file_path"]):
            return None
        if os.path.getsize(model_path) != entry.get("size_bytes"):
            return None
        if model_key == "flood_segmenter":
            metrics = entry.get("benchmark_metrics") or {}
            if (entry.get("provenance_status") != "VALIDATED_HCMC_ROAD_FLOOD"
                    or not metrics.get("validation_dataset")
                    or metrics.get("iou") is None or metrics["iou"] < 0.70
                    or metrics.get("f1_score") is None or metrics["f1_score"] < 0.80
                    or not metrics.get("rain_night_reflection_reviewed")):
                return None
        hasher = hashlib.sha256()
        with open(model_path, "rb") as weights:
            for chunk in iter(lambda: weights.read(1024 * 1024), b""):
                hasher.update(chunk)
        if not hmac.compare_digest(hasher.hexdigest(), expected_hash):
            logger.error("Model SHA-256 mismatch for %s", model_key)
            return None
        return entry
    except (OSError, KeyError, TypeError, ValueError) as exc:
        logger.warning("Model manifest validation failed for %s: %s", model_key, exc)
        return None


def _validate_onnx_schema(session: Any, entry: Dict[str, Any]) -> bool:
    try:
        inp, out = session.get_inputs()[0], session.get_outputs()[0]
        expected_in, expected_out = entry["expected_input"], entry["expected_output"]
        onnx_dtype = {"float32": "float", "float16": "float16"}
        return (inp.name == expected_in["name"] and inp.shape == expected_in["shape"]
                and inp.type == f"tensor({onnx_dtype[expected_in['dtype']]})"
                and out.name == expected_out["name"] and out.shape == expected_out["shape"]
                and out.type == f"tensor({onnx_dtype[expected_out['dtype']]})")
    except (IndexError, KeyError, TypeError):
        return False


@dataclass
class PreprocessResult:
    """Preprocessed image and ROI metadata."""
    original_image: np.ndarray
    roi_mask: np.ndarray
    roi_image: np.ndarray
    roi_pixel_count: int
    mean_luminance: float
    laplacian_var: float
    is_dark: bool
    is_blurry: bool
    height: int
    width: int


@dataclass
class DetectedVehicle:
    """Detected vehicle instance from real inference."""
    cls_name: str
    confidence: float
    bbox: Tuple[int, int, int, int]  # x1, y1, x2, y2
    weight: float


@dataclass
class VehicleDetectionResult:
    """Aggregate vehicle detection output from real ONNX model."""
    model_status: str  # "VERIFIED_ONNX_INFERENCE" or "MODEL_UNAVAILABLE"
    is_available: bool
    vehicle_count: int  # Snapshot count of observed objects, NOT traffic flow or velocity
    traffic_density_score: float  # Estimated saturation score in [0.0, 1.0]
    vehicles: List[DetectedVehicle] = field(default_factory=list)
    model_name: Optional[str] = None
    model_sha256: Optional[str] = None
    error_message: Optional[str] = None


@dataclass
class FloodSegmentationResult:
    """Water segmentation output from real ONNX segmentation model."""
    model_status: str  # "VERIFIED_ONNX_INFERENCE", "MODEL_UNAVAILABLE", or "OPENCV_HEURISTIC_BASELINE"
    is_available: bool
    flood_ratio: Optional[float]  # Pixel proportion of suspected water in ROI, NOT water depth in cm
    water_pixel_count: int
    water_mask: Optional[np.ndarray] = None
    uncertainty: float = 0.0  # Normalized uncertainty score in [0.0, 1.0]
    model_name: Optional[str] = None
    model_sha256: Optional[str] = None
    error_message: Optional[str] = None


def letterbox(
    im: np.ndarray,
    new_shape: Tuple[int, int] = (640, 640),
    color: Tuple[int, int, int] = (114, 114, 114),
) -> Tuple[np.ndarray, float, Tuple[float, float]]:
    """Resizes and pads image for YOLO inference preserving aspect ratio."""
    shape = im.shape[:2]  # [h, w]
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    new_unpad = int(round(shape[1] * r)), int(round(shape[0] * r))
    dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]
    dw /= 2.0
    dh /= 2.0
    if shape[::-1] != new_unpad:
        im = cv2.resize(im, new_unpad, interpolation=cv2.INTER_LINEAR)
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    im = cv2.copyMakeBorder(im, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
    return im, r, (dw, dh)


def preprocess_camera_image(
    image_path: str,
    top_crop_ratio: float = 0.25,
) -> PreprocessResult:
    """
    Reads camera frame from disk, applies Region of Interest (ROI) mask
    eliminating the top 25% (sky/banners/timestamps), and evaluates image quality.
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found at path: {image_path}")

    image = cv2.imread(image_path)
    if image is None or image.size == 0:
        raise ValueError(f"Corrupted or empty image at path: {image_path}")

    h, w = image.shape[:2]
    roi_top_offset = int(h * top_crop_ratio)

    # ROI mask focusing on road surface (top 25% discarded)
    roi_mask = np.zeros((h, w), dtype=np.uint8)
    roi_mask[roi_top_offset:, :] = 255
    roi_pixel_count = int(np.count_nonzero(roi_mask))

    roi_image = cv2.bitwise_and(image, image, mask=roi_mask)

    # Quality check 1: Mean Luminance on HSV V-channel
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mean_luminance = float(np.mean(hsv[roi_top_offset:, :, 2]))
    is_dark = mean_luminance < 35.0

    # Quality check 2: Sharpness / Blurriness via Laplacian variance
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    laplacian_var = float(cv2.Laplacian(gray[roi_top_offset:, :], cv2.CV_64F).var())
    is_blurry = laplacian_var < 50.0

    return PreprocessResult(
        original_image=image,
        roi_mask=roi_mask,
        roi_image=roi_image,
        roi_pixel_count=roi_pixel_count,
        mean_luminance=round(mean_luminance, 2),
        laplacian_var=round(laplacian_var, 2),
        is_dark=is_dark,
        is_blurry=is_blurry,
        height=h,
        width=w,
    )


class VehicleDetector:
    """
    Real ONNX Vehicle Detector utilizing verified YOLOv5n weights.
    Zero-Mock: Does NOT fall back to running OpenCV heuristic when weights are missing.
    In testing environments, supports explicit baseline heuristic mode.
    """

    def __init__(
        self,
        model_path: Optional[str] = DEFAULT_YOLO_PATH,
        fallback_to_heuristic: Optional[bool] = None,
    ):
        self.model_path = model_path
        if fallback_to_heuristic is None:
            self.fallback_to_heuristic = (os.getenv("VISION_ALLOW_HEURISTIC_BASELINE") == "1")
        else:
            self.fallback_to_heuristic = fallback_to_heuristic
        self.session = None
        self.model_sha256 = None
        self.model_status = "MODEL_UNAVAILABLE"
        self.version = "v7.0"
        self.provenance_status = "MODEL_UNAVAILABLE"
        self.validation_status = "EXPERIMENTAL_HCMC"

        if model_path and os.path.exists(model_path):
            try:
                import onnxruntime as ort
                entry = verified_model_manifest_entry("vehicle_detector", model_path)
                if entry is None:
                    raise ValueError("weights do not match the approved SHA-256 manifest")
                self.model_sha256 = entry["sha256"]
                self.session = ort.InferenceSession(model_path)
                if not _validate_onnx_schema(self.session, entry):
                    raise ValueError("ONNX input/output schema differs from manifest")
                self.version = entry["version"]
                self.provenance_status = entry["provenance_status"]
                self.validation_status = entry.get("deployment_validation", "EXPERIMENTAL_HCMC")
                self.model_status = "VERIFIED_ONNX_INFERENCE"
                logger.info(
                    "Loaded verified ONNX Vehicle Detector from %s (SHA-256: %s...)",
                    model_path,
                    self.model_sha256[:12],
                )
            except Exception as exc:
                logger.error("Failed to initialize ONNX session for %s: %s", model_path, exc)
                self.session = None
                self.model_status = "MODEL_UNAVAILABLE"

    def detect_vehicles(
        self,
        prep: PreprocessResult,
        conf_threshold: float = 0.25,
        nms_threshold: float = 0.45,
    ) -> VehicleDetectionResult:
        """
        Executes real ONNX inference on camera frame.
        Counts observed vehicles at this snapshot instant (NOT traffic velocity).
        """
        if self.session is not None and self.model_status == "VERIFIED_ONNX_INFERENCE":
            res = self._detect_onnx(prep, conf_threshold=conf_threshold, nms_threshold=nms_threshold)
            # If ONNX detects vehicles or heuristic fallback is disabled, return real inference
            if res.vehicle_count > 0 or not self.fallback_to_heuristic:
                return res

        # In testing environments only: fallback to heuristic baseline if explicitly enabled
        if self.fallback_to_heuristic:
            return self._detect_opencv_heuristic(prep)

        return VehicleDetectionResult(
            model_status="MODEL_UNAVAILABLE",
            is_available=False,
            vehicle_count=0,
            traffic_density_score=0.0,
            vehicles=[],
            model_name=os.path.basename(self.model_path or "yolov5n.onnx"),
            model_sha256=self.model_sha256,
            error_message="MODEL_UNAVAILABLE: Model weights missing or failed to initialize.",
        )

    def _detect_onnx(
        self,
        prep: PreprocessResult,
        conf_threshold: float = 0.25,
        nms_threshold: float = 0.45,
    ) -> VehicleDetectionResult:
        """Performs true ONNX forward pass, box decoding, and NMS."""
        orig_img = prep.original_image
        h_orig, w_orig = prep.height, prep.width

        # 1. Preprocessing: letterbox to 640x640
        img_letter, r, (dw, dh) = letterbox(orig_img, (640, 640))
        # BGR to RGB, HWC to CHW
        blob = img_letter[:, :, ::-1].transpose(2, 0, 1)
        input_type = self.session.get_inputs()[0].type
        dtype = np.float16 if input_type == "tensor(float16)" else np.float32 if input_type == "tensor(float)" else None
        if dtype is None:
            raise ValueError(f"Unsupported ONNX input type: {input_type}")
        blob = np.ascontiguousarray(blob, dtype=dtype) / dtype(255.0)
        blob = blob[None, ...]  # Shape: [1, 3, 640, 640]

        # 2. Forward pass via ONNX Runtime
        input_name = self.session.get_inputs()[0].name
        output_name = self.session.get_outputs()[0].name
        out = self.session.run([output_name], {input_name: blob})[0]  # [1, 25200, 85]
        if out.shape != (1, 25200, 85):
            raise ValueError(f"Expected YOLOv5 [1,25200,85], got {out.shape}; YOLO26 requires its own decoder")

        detections = out[0]  # [25200, 85]
        boxes: List[List[int]] = []
        confidences: List[float] = []
        class_ids: List[int] = []

        # 3. Decode candidate anchor boxes
        for row in detections:
            obj_conf = float(row[4])
            if obj_conf < conf_threshold:
                continue

            class_scores = row[5:]
            class_id = int(np.argmax(class_scores))
            class_conf = float(class_scores[class_id])
            total_score = obj_conf * class_conf

            if total_score >= conf_threshold and class_id in COCO_VEHICLE_CLASSES:
                cx, cy, w, h = float(row[0]), float(row[1]), float(row[2]), float(row[3])
                # Unpad coordinates back to original image scale
                x1 = int(round((cx - w / 2.0 - dw) / r))
                y1 = int(round((cy - h / 2.0 - dh) / r))
                box_w = int(round(w / r))
                box_h = int(round(h / r))

                # Clamp to image boundaries
                x1 = max(0, min(w_orig - 1, x1))
                y1 = max(0, min(h_orig - 1, y1))
                box_w = max(1, min(w_orig - x1, box_w))
                box_h = max(1, min(h_orig - y1, box_h))

                boxes.append([x1, y1, box_w, box_h])
                confidences.append(total_score)
                class_ids.append(class_id)

        # 4. Non-Maximum Suppression (NMS)
        indices = cv2.dnn.NMSBoxes(boxes, confidences, conf_threshold, nms_threshold)

        detected_vehicles: List[DetectedVehicle] = []
        total_weight = 0.0

        if len(indices) > 0:
            for idx in indices.flatten():
                x, y, bw, bh = boxes[idx]
                cid = class_ids[idx]
                conf = confidences[idx]
                cls_name, weight = COCO_VEHICLE_CLASSES[cid]

                detected_vehicles.append(
                    DetectedVehicle(
                        cls_name=cls_name,
                        confidence=round(conf, 3),
                        bbox=(x, y, x + bw, y + bh),
                        weight=weight,
                    )
                )
                total_weight += weight

        density_score = min(1.0, max(0.0, round(total_weight / DENSITY_SATURATION_WEIGHT, 3)))

        return VehicleDetectionResult(
            model_status="VERIFIED_ONNX_INFERENCE",
            is_available=True,
            vehicle_count=len(detected_vehicles),
            traffic_density_score=density_score,
            vehicles=detected_vehicles,
            model_name=os.path.basename(self.model_path or "yolov5n.onnx"),
            model_sha256=self.model_sha256[:16] if self.model_sha256 else None,
            error_message=None,
        )

    def detect_vehicles_opencv_baseline(self, prep: PreprocessResult) -> VehicleDetectionResult:
        """
        Baseline OpenCV contour detector for experimental comparison only.
        Explicitly marked OPENCV_HEURISTIC_BASELINE.
        """
        roi_img = prep.roi_image
        hsv = cv2.cvtColor(roi_img, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1]
        sat_mask = cv2.threshold(sat, 25, 255, cv2.THRESH_BINARY)[1]

        gray = cv2.cvtColor(roi_img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 30, 100)
        edge_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        dilated_edges = cv2.dilate(edges, edge_kernel, iterations=2)

        combined_features = cv2.bitwise_or(sat_mask, dilated_edges)
        combined_features = cv2.bitwise_and(combined_features, prep.roi_mask)

        morph_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        cleaned = cv2.morphologyEx(combined_features, cv2.MORPH_OPEN, morph_kernel)
        contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        detected_vehicles: List[DetectedVehicle] = []
        total_weight = 0.0

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 300 or area > 18000:
                continue
            x, y, w, h = cv2.boundingRect(cnt)
            aspect_ratio = float(w) / float(h)
            if aspect_ratio < 0.35 or aspect_ratio > 3.5:
                continue

            if area < 1200:
                cls_name, weight = "motorcycle", VEHICLE_WEIGHTS["motorcycle"]
            elif area < 5000:
                cls_name, weight = "car", VEHICLE_WEIGHTS["car"]
            elif aspect_ratio > 1.8:
                cls_name, weight = "bus", VEHICLE_WEIGHTS["bus"]
            else:
                cls_name, weight = "truck", VEHICLE_WEIGHTS["truck"]

            total_weight += weight
            detected_vehicles.append(
                DetectedVehicle(
                    cls_name=cls_name,
                    confidence=0.70,
                    bbox=(x, y, x + w, y + h),
                    weight=weight,
                )
            )

        density_score = min(1.0, max(0.0, round(total_weight / DENSITY_SATURATION_WEIGHT, 3)))
        return VehicleDetectionResult(
            model_status="OPENCV_HEURISTIC_BASELINE",
            is_available=True,
            vehicle_count=len(detected_vehicles),
            traffic_density_score=density_score,
            vehicles=detected_vehicles,
            model_name="opencv_contour_baseline",
            model_sha256=None,
            error_message="Experimental baseline: heuristic only, not validated AI.",
        )

    # Backward-compatible alias for baseline test suites
    _detect_opencv_heuristic = detect_vehicles_opencv_baseline


class FloodSegmenter:
    """
    Flood Water Semantic Segmenter for urban road corridors.
    Zero-Mock: If official trained weights are missing, explicitly reports
    MODEL_UNAVAILABLE rather than disguising color contouring as AI.
    In testing environments, supports explicit baseline heuristic mode.
    """

    def __init__(
        self,
        model_path: Optional[str] = DEFAULT_FLOOD_UNET_PATH,
        fallback_to_heuristic: Optional[bool] = None,
    ):
        self.model_path = model_path
        if fallback_to_heuristic is None:
            self.fallback_to_heuristic = (os.getenv("VISION_ALLOW_HEURISTIC_BASELINE") == "1")
        else:
            self.fallback_to_heuristic = fallback_to_heuristic
        self.session = None
        self.model_sha256 = None
        self.model_status = "MODEL_UNAVAILABLE"
        self.version = None
        self.provenance_status = "MODEL_UNAVAILABLE"

        if model_path and os.path.exists(model_path):
            try:
                import onnxruntime as ort
                entry = verified_model_manifest_entry("flood_segmenter", model_path)
                if entry is None:
                    raise ValueError("flood weights lack SHA-256 or HCMC validation metrics")
                self.model_sha256 = entry["sha256"]
                self.session = ort.InferenceSession(model_path)
                if not _validate_onnx_schema(self.session, entry):
                    raise ValueError("Flood ONNX schema differs from manifest")
                self.version = entry["version"]
                self.provenance_status = entry["provenance_status"]
                self.model_status = "VERIFIED_ONNX_INFERENCE"
                logger.info("Loaded verified ONNX Flood Segmentation model from %s", model_path)
            except Exception as exc:
                logger.warning("Failed to load ONNX segmentation model (%s): %s", model_path, exc)
                self.session = None
                self.model_status = "MODEL_UNAVAILABLE"

    def segment_flood_water(self, prep: PreprocessResult) -> FloodSegmentationResult:
        """
        Segments water pixels strictly within the camera ROI.
        Computes flood_ratio as the proportion of pixels identified as suspected water.
        Does NOT claim or extrapolate water depth (cm).
        """
        if self.session is not None and self.model_status == "VERIFIED_ONNX_INFERENCE":
            return self._segment_onnx(prep)

        if self.fallback_to_heuristic:
            return self.run_baseline_opencv_heuristic(prep)

        return FloodSegmentationResult(
            model_status="MODEL_UNAVAILABLE",
            is_available=False,
            flood_ratio=None,
            water_pixel_count=0,
            water_mask=None,
            uncertainty=1.0,
            model_name=os.path.basename(self.model_path or "flood_unet.onnx"),
            model_sha256=None,
            error_message="MODEL_UNAVAILABLE: No verified flood segmentation ONNX model weights provided.",
        )

    def _segment_onnx(self, prep: PreprocessResult) -> FloodSegmentationResult:
        """Executes true ONNX semantic segmentation forward pass."""
        roi_img = prep.roi_image
        h_orig, w_orig = prep.height, prep.width

        # Resize to model expected input (e.g. 256x256)
        in_tensor = cv2.resize(roi_img, (256, 256), interpolation=cv2.INTER_LINEAR)
        in_tensor = in_tensor[:, :, ::-1].transpose(2, 0, 1)  # BGR to RGB
        input_type = self.session.get_inputs()[0].type
        dtype = np.float16 if input_type == "tensor(float16)" else np.float32 if input_type == "tensor(float)" else None
        if dtype is None:
            raise ValueError(f"Unsupported flood ONNX input type: {input_type}")
        in_tensor = np.ascontiguousarray(in_tensor, dtype=dtype) / dtype(255.0)
        in_tensor = in_tensor[None, ...]

        input_name = self.session.get_inputs()[0].name
        output_name = self.session.get_outputs()[0].name
        raw_out = self.session.run([output_name], {input_name: in_tensor})[0]

        # Squeeze to 2D probability map
        prob_map = 1.0 / (1.0 + np.exp(-raw_out.squeeze()))  # Sigmoid
        binary_mask = (prob_map >= 0.5).astype(np.uint8) * 255

        # Resize mask back to original ROI dimensions preserving geometry
        water_mask = cv2.resize(binary_mask, (w_orig, h_orig), interpolation=cv2.INTER_NEAREST)
        water_mask = cv2.bitwise_and(water_mask, prep.roi_mask)

        water_pixel_count = int(np.count_nonzero(water_mask))
        flood_ratio = round(float(water_pixel_count) / max(1, prep.roi_pixel_count), 3)

        # Uncertainty: average distance of probabilities from confident 0 or 1
        uncertainty = float(np.mean(1.0 - 2.0 * np.abs(prob_map - 0.5)))

        return FloodSegmentationResult(
            model_status="VERIFIED_ONNX_INFERENCE",
            is_available=True,
            flood_ratio=min(1.0, max(0.0, flood_ratio)),
            water_pixel_count=water_pixel_count,
            water_mask=water_mask,
            uncertainty=round(uncertainty, 3),
            model_name=os.path.basename(self.model_path or "flood_unet.onnx"),
            model_sha256=self.model_sha256[:16] if self.model_sha256 else None,
            error_message=None,
        )

    def run_baseline_opencv_heuristic(self, prep: PreprocessResult) -> FloodSegmentationResult:
        """
        OpenCV Color & Texture heuristic for baseline comparison only.
        Explicitly labeled OPENCV_HEURISTIC_COLOR_SPACE.
        """
        roi_img = prep.roi_image
        hsv = cv2.cvtColor(roi_img, cv2.COLOR_BGR2HSV)
        lab = cv2.cvtColor(roi_img, cv2.COLOR_BGR2LAB)

        lower_murky = np.array([8, 30, 40], dtype=np.uint8)
        upper_murky = np.array([35, 180, 185], dtype=np.uint8)
        mask_murky = cv2.inRange(hsv, lower_murky, upper_murky)

        lower_blue = np.array([85, 25, 40], dtype=np.uint8)
        upper_blue = np.array([135, 200, 210], dtype=np.uint8)
        mask_blue = cv2.inRange(hsv, lower_blue, upper_blue)

        l_channel = lab[:, :, 0]
        mask_reflection = cv2.inRange(l_channel, 170, 255)

        combined_water = cv2.bitwise_or(mask_murky, mask_blue)
        combined_water = cv2.bitwise_or(combined_water, mask_reflection)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        cleaned_water = cv2.morphologyEx(combined_water, cv2.MORPH_OPEN, kernel)
        cleaned_water = cv2.morphologyEx(cleaned_water, cv2.MORPH_CLOSE, kernel)
        water_mask = cv2.bitwise_and(cleaned_water, prep.roi_mask)

        water_pixel_count = int(np.count_nonzero(water_mask))
        flood_ratio = min(
            1.0,
            max(0.0, round(float(water_pixel_count) / max(1, prep.roi_pixel_count), 3)),
        )

        return FloodSegmentationResult(
            model_status="OPENCV_HEURISTIC_COLOR_SPACE",
            is_available=True,
            flood_ratio=flood_ratio,
            water_pixel_count=water_pixel_count,
            water_mask=water_mask,
            uncertainty=0.45,
            model_name="opencv_color_texture_baseline",
            model_sha256=None,
            error_message="Baseline heuristic: color/texture analysis only, not validated AI.",
        )


def determine_camera_risk_level(
    vehicle_result: Optional[Union[VehicleDetectionResult, float]] = None,
    flood_result: Optional[Union[FloodSegmentationResult, float]] = None,
    flood_ratio: Optional[float] = None,
    traffic_density_score: Optional[float] = None,
) -> RiskLevel:
    """
    Evaluates risk level at camera location based on verified model outputs.
    Zero-Mock: Returns RiskLevel.UNKNOWN if models are unavailable or unverified.
    Does NOT extrapolate water depth in cm from 1 frame.
    Supports backward-compatible scalar evaluation for direct metric tests.
    """
    # 1. Handle legacy or direct scalar inputs
    if isinstance(vehicle_result, (int, float)):
        traffic_density_score = float(vehicle_result)
        vehicle_result = None
    if isinstance(flood_result, (int, float)):
        flood_ratio = float(flood_result)
        flood_result = None

    if flood_ratio is not None and traffic_density_score is not None:
        if flood_ratio >= CRITICAL_FLOOD_RATIO or traffic_density_score >= CRITICAL_TRAFFIC_DENSITY:
            return RiskLevel.CRITICAL
        elif flood_ratio >= MODERATE_FLOOD_RATIO or traffic_density_score >= MODERATE_TRAFFIC_DENSITY:
            return RiskLevel.MODERATE
        return RiskLevel.SAFE

    # 2. Handle structured model results
    if vehicle_result is None or not vehicle_result.is_available:
        return RiskLevel.UNKNOWN

    density = vehicle_result.traffic_density_score
    has_flood_model = (
        flood_result is not None
        and flood_result.is_available
        and flood_result.flood_ratio is not None
    )

    if not has_flood_model:
        # Without verified flood segmentation, road cannot be claimed SAFE
        if density >= CRITICAL_TRAFFIC_DENSITY:
            return RiskLevel.CRITICAL
        elif density >= MODERATE_TRAFFIC_DENSITY:
            return RiskLevel.MODERATE
        return RiskLevel.UNKNOWN

    f_ratio = flood_result.flood_ratio

    # Check critical condition
    if f_ratio >= CRITICAL_FLOOD_RATIO or density >= CRITICAL_TRAFFIC_DENSITY:
        return RiskLevel.CRITICAL
    elif f_ratio >= MODERATE_FLOOD_RATIO or density >= MODERATE_TRAFFIC_DENSITY:
        return RiskLevel.MODERATE

    return RiskLevel.SAFE


def create_visual_evidence_overlay(
    prep: PreprocessResult,
    vehicle_result: VehicleDetectionResult,
    flood_result: FloodSegmentationResult,
    cam_meta: Dict[str, Any],
    dest_path: str,
) -> str:
    """
    Draws verified bounding boxes, water segmentation overlays, and provenance watermarks
    onto the source frame. If models are unavailable, records unverified banner without fake boxes.
    """
    annotated = prep.original_image.copy()
    h, w = prep.height, prep.width
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # 1. Overlay verified flood segmentation mask (if available)
    if flood_result.is_available and flood_result.water_mask is not None:
        blue_overlay = np.zeros_like(annotated)
        blue_overlay[:] = (220, 150, 40)  # Cyan/Blue tint for water
        mask_3ch = cv2.cvtColor(flood_result.water_mask, cv2.COLOR_GRAY2BGR)
        water_region = cv2.bitwise_and(blue_overlay, mask_3ch)
        annotated = cv2.addWeighted(annotated, 1.0, water_region, 0.45, 0)

    # 2. Draw verified vehicle bounding boxes (if available)
    if vehicle_result.is_available:
        for v in vehicle_result.vehicles:
            x1, y1, x2, y2 = v.bbox
            color = (0, 220, 0) if v.cls_name == "motorcycle" else (0, 165, 255)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 1)
            label = f"{v.cls_name} {v.confidence:.2f}"
            cv2.putText(
                annotated,
                label,
                (x1, max(12, y1 - 3)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.35,
                color,
                1,
                cv2.LINE_AA,
            )

    # 3. Provenance Watermark Banner
    cv2.rectangle(annotated, (0, 0), (w, 22), (20, 24, 30), -1)
    model_tag = (
        f"ONNX YOLOv5n [{vehicle_result.model_sha256[:8]}]"
        if vehicle_result.is_available and vehicle_result.model_sha256
        else "MODEL_UNAVAILABLE"
    )
    cam_code = cam_meta.get("code") or cam_meta.get("cam_id", "CAM")[:8]
    banner_text = f"SafePathAI | {cam_code} | {model_tag} | {now_str}"
    cv2.putText(
        annotated,
        banner_text,
        (6, 15),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.32,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )

    # Save to disk
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    cv2.imwrite(dest_path, annotated)
    return dest_path


class CameraVisionPipeline:
    """
    Orchestrates preprocessing, vehicle detection, flood segmentation,
    and visual evidence generation for a single camera frame.
    """

    def __init__(
        self,
        vehicle_model_path: Optional[str] = DEFAULT_YOLO_PATH,
        flood_model_path: Optional[str] = DEFAULT_FLOOD_UNET_PATH,
        fallback_to_heuristic: Optional[bool] = None,
    ):
        if fallback_to_heuristic is None:
            allow_baseline = (os.getenv("VISION_ALLOW_HEURISTIC_BASELINE") == "1")
        else:
            allow_baseline = fallback_to_heuristic
        self.vehicle_detector = VehicleDetector(vehicle_model_path, fallback_to_heuristic=allow_baseline)
        self.flood_segmenter = FloodSegmenter(flood_model_path, fallback_to_heuristic=allow_baseline)

    def analyze_camera_image(
        self,
        image_path: str,
        cam_meta: Dict[str, Any],
        storage_dir: str = "storage/cams",
    ) -> CameraEvidence:
        """Runs end-to-end analysis on local image."""
        prep = preprocess_camera_image(image_path)
        veh_result = self.vehicle_detector.detect_vehicles(prep)
        flood_result = self.flood_segmenter.segment_flood_water(prep)

        risk_level = determine_camera_risk_level(veh_result, flood_result)

        cam_id = str(cam_meta.get("cam_id") or "")
        overlay_filename = f"{cam_id}_annotated.jpg"
        overlay_path = os.path.join(storage_dir, overlay_filename)

        create_visual_evidence_overlay(
            prep=prep,
            vehicle_result=veh_result,
            flood_result=flood_result,
            cam_meta=cam_meta,
            dest_path=overlay_path,
        )

        analyzed_filename = f"{cam_id}_analyzed.jpg"
        analyzed_path = os.path.join(storage_dir, analyzed_filename)
        if os.path.exists(overlay_path) and overlay_path != analyzed_path:
            shutil.copyfile(overlay_path, analyzed_path)

        flood_ratio = flood_result.flood_ratio  # Zero-Mock: preserve None when unanalyzed/unavailable

        # Determine freshness against CAMERA_IMAGE_TTL_SECONDS
        now = datetime.now(timezone.utc)
        file_mtime = os.path.getmtime(image_path) if os.path.exists(image_path) else 0.0
        retrieved_at = datetime.fromtimestamp(file_mtime, timezone.utc) if file_mtime else None
        captured_at = cam_meta.get("captured_at")
        if isinstance(captured_at, str):
            try:
                captured_at = datetime.fromisoformat(captured_at)
            except ValueError:
                captured_at = None
        capture_fresh = (
            isinstance(captured_at, datetime) and captured_at.tzinfo is not None
            and 0 <= (now - captured_at).total_seconds() <= settings.CAMERA_IMAGE_TTL_SECONDS
        )
        is_fresh = capture_fresh and retrieved_at is not None and 0 <= (now - retrieved_at).total_seconds() <= settings.CAMERA_IMAGE_TTL_SECONDS
        source_st = DataSourceStatus.LIVE if is_fresh else DataSourceStatus.STALE

        # Routing eligibility gate
        los_ok = bool(cam_meta.get("line_of_sight_verified", False))
        way_ok = cam_meta.get("observed_osm_way_id") is not None
        eligibility = (
            EvidenceEligibility.ROUTING_ELIGIBLE
            if (los_ok and way_ok and is_fresh and settings.CAMERA_ROUTING_EVIDENCE_PERMITTED
                and self.vehicle_detector.validation_status == "VALIDATED_HCMC"
                and self.flood_segmenter.provenance_status == "VALIDATED_HCMC_ROAD_FLOOD")
            else EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING
        )
        if eligibility != EvidenceEligibility.ROUTING_ELIGIBLE:
            risk_level = RiskLevel.UNKNOWN

        return CameraEvidence(
            cam_id=cam_id,
            code=cam_meta.get("code"),
            name=cam_meta.get("name") or f"Camera {cam_id}",
            district=cam_meta.get("district"),
            lat=float(cam_meta.get("lat") or 0.0),
            lng=float(cam_meta.get("lng") or 0.0),
            osm_way_id=cam_meta.get("nearest_osm_way_id"),
            coordinate_source_url=cam_meta.get("coordinate_source_url"),
            spatial_match_status=cam_meta.get("spatial_match_status", "SPATIALLY_NEAR"),
            observed_osm_way_id=cam_meta.get("observed_osm_way_id"),
            observed_edge_index=cam_meta.get("observed_edge_index"),
            view_verification_source_url=cam_meta.get("view_verification_source_url"),
            line_of_sight_verified=los_ok,
            image_url=f"/api/v1/cameras/{cam_id}/image",
            has_image=True,
            image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC,
            evidence_eligibility=eligibility,
            image_status="VALID_IMAGE_CACHED",
            image_status_reason="VALID_IMAGE_CACHED",
            model_status="INFERENCE_COMPLETED" if veh_result.model_status == "VERIFIED_ONNX_INFERENCE" else veh_result.model_status,
            vehicle_model_name=veh_result.model_name,
            vehicle_model_version=self.vehicle_detector.version,
            vehicle_model_sha256=self.vehicle_detector.model_sha256,
            vehicle_model_provenance=self.vehicle_detector.provenance_status,
            vehicle_model_validation=self.vehicle_detector.validation_status,
            flood_model_status=flood_result.model_status,
            captured_at=captured_at if isinstance(captured_at, datetime) and captured_at.tzinfo else None,
            retrieved_at=retrieved_at,
            analyzed_at=now,
            vehicle_count=veh_result.vehicle_count if veh_result.is_available else None,
            traffic_density_score=veh_result.traffic_density_score if veh_result.is_available else None,
            flood_ratio=flood_ratio,
            risk_level=risk_level,
            source_status=source_st,
            updated_at=now,
        )


async def save_camera_evidence_to_redis(
    evidence: CameraEvidence,
    redis_client: Optional[Redis] = None,
) -> None:
    """Persists CameraEvidence to Redis hash, stream, and json."""
    close_redis = False
    if redis_client is None:
        redis_client = get_redis_client()
        close_redis = True

    try:
        # 1. Redis Hash: camera:state:{cam_id}
        hash_key = f"camera:state:{evidence.cam_id}"
        state_mapping = {
            "cam_id": str(evidence.cam_id),
            "code": str(evidence.code or ""),
            "risk_level": str(evidence.risk_level.value if hasattr(evidence.risk_level, "value") else evidence.risk_level),
            "flood_ratio": str(evidence.flood_ratio) if evidence.flood_ratio is not None else "",
            "traffic_density_score": str(evidence.traffic_density_score) if evidence.traffic_density_score is not None else "",
            "vehicle_count": str(evidence.vehicle_count) if evidence.vehicle_count is not None else "",
            "updated_at": evidence.updated_at.isoformat() if evidence.updated_at else datetime.now(timezone.utc).isoformat(),
        }
        await redis_client.hset(hash_key, mapping=state_mapping)
        await redis_client.expire(hash_key, 600)

        # 2. Redis Stream: stream:camera_updates
        stream_payload = {
            "cam_id": str(evidence.cam_id),
            "risk_level": str(evidence.risk_level.value if hasattr(evidence.risk_level, "value") else evidence.risk_level),
            "flood_ratio": str(evidence.flood_ratio) if evidence.flood_ratio is not None else "",
            "traffic_density_score": str(evidence.traffic_density_score) if evidence.traffic_density_score is not None else "",
            "vehicle_count": str(evidence.vehicle_count) if evidence.vehicle_count is not None else "",
        }
        await redis_client.xadd("stream:camera_updates", stream_payload)

        # 3. JSON document: camera_evidence:{cam_id}
        evidence_json_key = f"camera_evidence:{evidence.cam_id}"
        payload = evidence.model_dump(mode="json")
        await redis_client.set(evidence_json_key, json.dumps(payload), ex=600)
    except Exception as exc:
        logger.warning("Failed to persist CameraEvidence %s to Redis: %s", evidence.cam_id, exc)
    finally:
        if close_redis:
            await redis_client.aclose()


async def process_all_cameras_vision(
    cameras: List[Dict[str, Any]],
    storage_dir: str = "storage/cams",
    pipeline: Optional[CameraVisionPipeline] = None,
    redis_client: Optional[Redis] = None,
) -> List[CameraEvidence]:
    """Batch processes a list of camera snapshots through CV pipeline."""
    if pipeline is None:
        pipeline = CameraVisionPipeline()

    results: List[CameraEvidence] = []
    close_redis = False
    if redis_client is None:
        redis_client = get_redis_client()
        close_redis = True

    try:
        for cam in cameras:
            cam_id = str(cam.get("cam_id") or "")
            image_path = cam.get("image_path") or os.path.join(storage_dir, f"{cam_id}.jpg")

            if not os.path.exists(image_path):
                continue

            try:
                evidence = pipeline.analyze_camera_image(
                    image_path=image_path,
                    cam_meta=cam,
                    storage_dir=storage_dir,
                )
                await save_camera_evidence_to_redis(evidence, redis_client=redis_client)
                results.append(evidence)
            except Exception as exc:
                logger.error("Error processing camera %s through vision pipeline: %s", cam_id, exc)
    finally:
        if close_redis:
            await redis_client.aclose()

    return results
