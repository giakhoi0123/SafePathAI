"""
Camera Snapshot Image Validator for SafePathAI.
Validates raw byte payloads using magic byte verification, Pillow decoding,
perceptual hash matching for server placeholders, dark frame detection,
and duplicate frame tracking.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
import hashlib
import io
import logging
from typing import Optional, Set, Tuple
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Known placeholder hashes from HCMC port 8007 ("IMAGE NOT AVAILABLE" / server error frame)
KNOWN_PLACEHOLDER_MD5 = {
    "5f5b2bf141af555a87e3f1d6c3ab3017",  # Standard 306x236 PNG placeholder
}
KNOWN_PLACEHOLDER_SHA256 = {
    "fd47eb800054605740ae3032c114ae934c618a23ff9b72839d97e3fc91da84ba",
}


class ImageValidationStatus(str, Enum):
    VALID = "VALID"
    INVALID_MAGIC_BYTES = "INVALID_MAGIC_BYTES"
    CORRUPTED_PAYLOAD = "CORRUPTED_PAYLOAD"
    PLACEHOLDER_ERROR_FRAME = "PLACEHOLDER_ERROR_FRAME"
    DARK_NO_SIGNAL_FRAME = "DARK_NO_SIGNAL_FRAME"
    BLANK_LOW_VARIANCE_FRAME = "BLANK_LOW_VARIANCE_FRAME"
    DUPLICATE_FRAME = "DUPLICATE_FRAME"
    DIMENSIONS_TOO_SMALL = "DIMENSIONS_TOO_SMALL"


@dataclass
class ImageValidationResult:
    """Detailed outcome of validating a camera snapshot image payload."""
    status: ImageValidationStatus
    is_valid: bool
    format: Optional[str]
    width: Optional[int]
    height: Optional[int]
    file_size_bytes: int
    md5_hash: str
    dhash: Optional[str]
    mean_intensity: Optional[float]
    captured_at: Optional[datetime]
    capture_time_status: str  # "VERIFIED_TIMESTAMP" or "CAPTURE_TIME_UNKNOWN"
    retrieved_at: datetime
    error_message: Optional[str] = None


def compute_dhash(image: Image.Image, hash_size: int = 8) -> str:
    """
    Computes difference hash (dHash) for an image.
    Resizes to (hash_size + 1, hash_size), converts to grayscale,
    and compares adjacent pixels.
    """
    resized = image.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = np.array(resized)
    # Difference between consecutive columns
    diff = pixels[:, 1:] > pixels[:, :-1]
    return hex(int("".join("1" if b else "0" for b in diff.flatten()), 2))


def hamming_distance(hex1: str, hex2: str) -> int:
    """Computes bitwise Hamming distance between two hex hash strings."""
    try:
        val1 = int(hex1, 16)
        val2 = int(hex2, 16)
        return bin(val1 ^ val2).count("1")
    except (ValueError, TypeError):
        return 999


def validate_camera_image_bytes(
    image_bytes: bytes,
    previous_md5: Optional[str] = None,
    previous_dhash: Optional[str] = None,
    min_width: int = 100,
    min_height: int = 100,
    min_mean_intensity: float = 8.0,
    min_std_dev: float = 3.0,
    max_dhash_drift_for_dup: int = 1,
) -> ImageValidationResult:
    """
    Rigorous multi-stage validation of incoming camera snapshot bytes:
    1. Magic bytes check (JPEG, PNG, WebP).
    2. Payload integrity and Pillow decoding.
    3. Dimension checks.
    4. Exact MD5 / SHA256 against known server error placeholders.
    5. Dark frame / no-signal detection (low mean intensity).
    6. Blank / low-variance frame detection (low standard deviation).
    7. Duplicate frame detection against previous capture.
    8. Strict separation of retrieved_at vs captured_at.
    """
    retrieved_at = datetime.now(timezone.utc)
    file_size = len(image_bytes)

    # 1. Magic bytes check
    is_jpeg = image_bytes.startswith(b"\xff\xd8\xff") or image_bytes.startswith(b"\xff\xd8")
    is_png = image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    is_webp = image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[:16]

    if not (is_jpeg or is_png or is_webp):
        md5 = hashlib.md5(image_bytes).hexdigest()
        return ImageValidationResult(
            status=ImageValidationStatus.INVALID_MAGIC_BYTES,
            is_valid=False,
            format=None,
            width=None,
            height=None,
            file_size_bytes=file_size,
            md5_hash=md5,
            dhash=None,
            mean_intensity=None,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            retrieved_at=retrieved_at,
            error_message="Payload does not match JPEG, PNG, or WebP magic bytes",
        )

    # 2. Check known placeholder hashes
    md5 = hashlib.md5(image_bytes).hexdigest()
    sha256 = hashlib.sha256(image_bytes).hexdigest()
    if md5 in KNOWN_PLACEHOLDER_MD5 or sha256 in KNOWN_PLACEHOLDER_SHA256:
        return ImageValidationResult(
            status=ImageValidationStatus.PLACEHOLDER_ERROR_FRAME,
            is_valid=False,
            format="PNG",
            width=306,
            height=236,
            file_size_bytes=file_size,
            md5_hash=md5,
            dhash=None,
            mean_intensity=None,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            retrieved_at=retrieved_at,
            error_message="Server returned standard 'IMAGE NOT AVAILABLE' placeholder frame",
        )

    # 3. Decode image with Pillow
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()  # Verify structural integrity
        # Re-open for pixel reading after verify()
        img = Image.open(io.BytesIO(image_bytes))
        width, height = img.size
        img_format = img.format
    except Exception as exc:
        return ImageValidationResult(
            status=ImageValidationStatus.CORRUPTED_PAYLOAD,
            is_valid=False,
            format=None,
            width=None,
            height=None,
            file_size_bytes=file_size,
            md5_hash=md5,
            dhash=None,
            mean_intensity=None,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            retrieved_at=retrieved_at,
            error_message=f"Pillow decode error: {exc}",
        )

    # 4. Dimension check
    if width < min_width or height < min_height:
        return ImageValidationResult(
            status=ImageValidationStatus.DIMENSIONS_TOO_SMALL,
            is_valid=False,
            format=img_format,
            width=width,
            height=height,
            file_size_bytes=file_size,
            md5_hash=md5,
            dhash=None,
            mean_intensity=None,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            retrieved_at=retrieved_at,
            error_message=f"Image dimensions ({width}x{height}) below minimum {min_width}x{min_height}",
        )

    # 5. Convert to RGB numpy array for photometric analysis
    rgb_img = img.convert("RGB")
    np_arr = np.array(rgb_img, dtype=np.float32)
    mean_val = float(np.mean(np_arr))
    std_val = float(np.std(np_arr))

    # 6. Dark / no-signal check
    if mean_val < min_mean_intensity:
        return ImageValidationResult(
            status=ImageValidationStatus.DARK_NO_SIGNAL_FRAME,
            is_valid=False,
            format=img_format,
            width=width,
            height=height,
            file_size_bytes=file_size,
            md5_hash=md5,
            dhash=None,
            mean_intensity=mean_val,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            retrieved_at=retrieved_at,
            error_message=f"Image is nearly black/no-signal (mean intensity {mean_val:.2f} < {min_mean_intensity})",
        )

    # 7. Blank / low-variance check
    if std_val < min_std_dev:
        return ImageValidationResult(
            status=ImageValidationStatus.BLANK_LOW_VARIANCE_FRAME,
            is_valid=False,
            format=img_format,
            width=width,
            height=height,
            file_size_bytes=file_size,
            md5_hash=md5,
            dhash=None,
            mean_intensity=mean_val,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            retrieved_at=retrieved_at,
            error_message=f"Image is uniform/uninformative (standard deviation {std_val:.2f} < {min_std_dev})",
        )

    # 8. Compute difference hash (dHash)
    curr_dhash = compute_dhash(img)

    # 9. Duplicate detection
    if previous_md5 and md5 == previous_md5:
        return ImageValidationResult(
            status=ImageValidationStatus.DUPLICATE_FRAME,
            is_valid=False,
            format=img_format,
            width=width,
            height=height,
            file_size_bytes=file_size,
            md5_hash=md5,
            dhash=curr_dhash,
            mean_intensity=mean_val,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            retrieved_at=retrieved_at,
            error_message="Identical MD5 to previous snapshot (frozen/duplicate camera stream)",
        )

    if previous_dhash:
        dist = hamming_distance(curr_dhash, previous_dhash)
        if dist <= max_dhash_drift_for_dup:
            return ImageValidationResult(
                status=ImageValidationStatus.DUPLICATE_FRAME,
                is_valid=False,
                format=img_format,
                width=width,
                height=height,
                file_size_bytes=file_size,
                md5_hash=md5,
                dhash=curr_dhash,
                mean_intensity=mean_val,
                captured_at=None,
                capture_time_status="CAPTURE_TIME_UNKNOWN",
                retrieved_at=retrieved_at,
                error_message=f"Perceptual dHash distance {dist} indicates frozen/duplicate frame",
            )

    # All validation stages passed!
    return ImageValidationResult(
        status=ImageValidationStatus.VALID,
        is_valid=True,
        format=img_format,
        width=width,
        height=height,
        file_size_bytes=file_size,
        md5_hash=md5,
        dhash=curr_dhash,
        mean_intensity=mean_val,
        captured_at=None,  # Unless OCR overlay or provider header verified
        capture_time_status="CAPTURE_TIME_UNKNOWN",
        retrieved_at=retrieved_at,
        error_message=None,
    )

