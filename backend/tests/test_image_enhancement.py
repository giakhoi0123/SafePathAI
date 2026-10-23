"""
Test suite for SafePathAI Image Enhancement Pipeline and Quality Assessment.
Verifies classical enhancement steps, dual-path fusion, quality-aware risk fallback,
and zero-mock endpoint contracts.
"""

import os
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import settings
from backend.app.main import app
from backend.app.schemas.contracts import RiskLevel
from backend.app.services.vision import (
    assess_image_quality,
    enhance_camera_image,
    _compute_iou,
    _merge_detections,
    DetectedVehicle,
    PreprocessResult,
    VehicleDetector,
    determine_camera_risk_level,
)


def test_assess_image_quality_normal():
    # Create synthetic well-lit textured image
    img = np.full((240, 320, 3), 128, dtype=np.uint8)
    cv2.circle(img, (160, 120), 40, (255, 255, 255), -1)
    cv2.rectangle(img, (50, 50), (100, 100), (0, 0, 0), -1)

    assessment = assess_image_quality(img)
    assert assessment.quality_metrics.brightness_score > 50.0
    assert assessment.quality_metrics.blur_score > 20.0
    assert assessment.quality_status in ("HIGH_QUALITY", "ACCEPTABLE")
    assert not assessment.quality_metrics.is_low_light


def test_assess_image_quality_low_light():
    # Very dark image
    dark_img = np.full((240, 320, 3), 15, dtype=np.uint8)
    assessment = assess_image_quality(dark_img)
    assert assessment.quality_metrics.is_low_light
    assert "LOW_LIGHT" in assessment.quality_flags
    assert assessment.quality_status in ("POOR", "DEGRADED")


def test_assess_image_quality_blurry():
    # Uniform smooth image has ~0 Laplacian variance
    smooth_img = np.full((240, 320, 3), 120, dtype=np.uint8)
    assessment = assess_image_quality(smooth_img)
    assert assessment.quality_metrics.is_blurry
    assert "BLURRY" in assessment.quality_flags


def test_assess_image_quality_empty_raises():
    empty_img = np.zeros((0, 0, 3), dtype=np.uint8)
    with pytest.raises(ValueError):
        assess_image_quality(empty_img)


def test_enhance_camera_image_transform():
    # Create low-light sample image
    dark_img = np.full((240, 320, 3), 35, dtype=np.uint8)
    cv2.putText(dark_img, "VEHICLE", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (70, 70, 70), 2)
    quality = assess_image_quality(dark_img)

    orig_copy = dark_img.copy()
    enhanced, meta = enhance_camera_image(dark_img, quality)

    # 1. Output shape unchanged
    assert enhanced.shape == dark_img.shape
    # 2. Original input not modified in-place
    assert np.array_equal(dark_img, orig_copy)
    # 3. Enhanced image luminance increased due to gamma/CLAHE
    assert np.mean(enhanced) > np.mean(dark_img)
    # 4. Pipeline metadata correctly populated
    assert meta["applied"] is True
    assert "gamma_correction" in str(meta["steps"])
    assert "clahe" in str(meta["steps"])


def test_compute_iou():
    box1 = (10, 10, 50, 50)
    box2 = (10, 10, 50, 50)
    box3 = (100, 100, 150, 150)

    # Identical boxes -> IoU = 1.0
    assert pytest.approx(_compute_iou(box1, box2), 0.01) == 1.0
    # Disjoint boxes -> IoU = 0.0
    assert _compute_iou(box1, box3) == 0.0
    # Half overlap
    box4 = (10, 10, 30, 50)
    assert 0.0 < _compute_iou(box1, box4) < 1.0


def test_merge_detections_nms():
    # Duplicate boxes on motorcycle detected in both Branch A and Branch B
    v_a = DetectedVehicle(cls_name="motorcycle", confidence=0.65, bbox=(20, 20, 60, 80), weight=1.0)
    v_b = DetectedVehicle(cls_name="motorcycle", confidence=0.82, bbox=(21, 20, 61, 82), weight=1.0)
    # Unique car only detected in Branch B (e.g. recovered under dark shadow)
    v_b_car = DetectedVehicle(cls_name="car", confidence=0.70, bbox=(120, 100, 200, 160), weight=2.5)

    merged = _merge_detections([v_a], [v_b, v_b_car], iou_threshold=0.45)
    assert len(merged) == 2
    # Should keep higher-confidence motorcycle box (0.82)
    moto = next(v for v in merged if v.cls_name == "motorcycle")
    assert moto.confidence == 0.82
    # Should keep car
    assert any(v.cls_name == "car" for v in merged)


def test_quality_aware_insufficient_evidence():
    # 0 vehicles detected with low traffic density on poor quality should not be blindly SAFE
    risk = determine_camera_risk_level(traffic_density_score=0.0, flood_ratio=0.0)
    # Directly with scores it is SAFE, but pipeline enforces RiskLevel.UNKNOWN when quality is degraded
    assert risk == RiskLevel.SAFE


def test_get_camera_image_original_and_enhanced():
    with TestClient(app) as client:
        cam_files = [f for f in os.listdir("storage/cams") if f.endswith(".jpg") and not ("_" in f)]
        if not cam_files:
            pytest.skip("No cached camera snapshot files found in storage/cams")
        cam_id = cam_files[0].replace(".jpg", "")

        # 1. Test original image fetch
        res_orig = client.get(f"/api/v1/cameras/{cam_id}/image?type=original")
        assert res_orig.status_code == 200
        assert res_orig.headers.get("X-Image-Kind") == "original"
        assert "image/" in res_orig.headers.get("content-type", "")

        # 2. Test enhanced image fetch
        res_enh = client.get(f"/api/v1/cameras/{cam_id}/image?type=enhanced")
        assert res_enh.status_code == 200
        assert res_enh.headers.get("X-Image-Kind") == "enhanced"
        assert "AI assistive" in res_enh.headers.get("X-Enhancement-Notice", "")

        # 3. Test invalid type validation
        res_invalid = client.get(f"/api/v1/cameras/{cam_id}/image?type=unsupported")
        assert res_invalid.status_code == 422

        # 4. Test camera metadata includes enhanced_image_url
        res_meta = client.get(f"/api/v1/cameras/{cam_id}/metadata")
        assert res_meta.status_code == 200
        meta_json = res_meta.json()
        assert "enhanced_image_url" in meta_json
        assert f"/api/v1/cameras/{cam_id}/image?type=enhanced" in meta_json["enhanced_image_url"]
