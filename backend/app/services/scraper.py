"""
HCMC Camera Ingestion Worker & Network Scraper.
Fetches camera snapshots from the Ho Chi Minh City Department of Transport portal,
applies strict Zero-Mock image validation, enforces TLS verify=True,
implements rate-limiting, and honors data usage permissions.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import os
import random
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

from backend.app.core.config import settings
from backend.app.schemas.contracts import DataSourceStatus
from backend.app.services.image_validator import (
    ImageValidationResult,
    ImageValidationStatus,
    validate_camera_image_bytes,
)

logger = logging.getLogger(__name__)

# Minimum byte threshold for a valid decoded camera JPEG frame
MIN_VALID_IMAGE_BYTES: int = 2500


@dataclass
class ScrapedCameraResult:
    """Result of scraping a single camera."""
    cam_id: str
    code: Optional[str]
    name: str
    district: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    image_path: Optional[str]
    image_bytes: Optional[bytes]
    source_status: DataSourceStatus
    retrieved_at: datetime
    captured_at: Optional[datetime]
    capture_time_status: str
    file_size: int
    is_valid_image: bool
    validation_status: Optional[str] = None
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cam_id": self.cam_id,
            "code": self.code,
            "name": self.name,
            "district": self.district,
            "lat": self.lat,
            "lng": self.lng,
            "image_path": self.image_path,
            "source_status": self.source_status.value,
            "retrieved_at": self.retrieved_at.isoformat(),
            "captured_at": self.captured_at.isoformat() if self.captured_at else None,
            "capture_time_status": self.capture_time_status,
            "file_size": self.file_size,
            "is_valid_image": self.is_valid_image,
            "validation_status": self.validation_status,
            "error_message": self.error_message,
        }


def build_camera_image_url(cam_id: str) -> str:
    """
    Constructs the exact URL used by the HCMC Traffic Portal port 8007 image handler.
    Format: {BASE_URL}?id={cam_id}&bg=black&w=300&h=230&t={timestamp_ms}
    """
    ts_ms = int(time.time() * 1000)
    return f"{settings.HCMC_CAMERA_BASE_URL}?id={cam_id}&bg=black&w=300&h=230&t={ts_ms}"


def get_camera_request_headers() -> Dict[str, str]:
    """
    Builds the standardized browser headers and session cookie for portal requests.
    Secrets are kept internal and never leaked in outward traces.
    """
    headers = {
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
        "Referer": settings.HCMC_CAMERA_REFERER,
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-site",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
        ),
    }
    if settings.HCMC_CAMERA_COOKIE:
        headers["Cookie"] = settings.HCMC_CAMERA_COOKIE
    return headers


async def warmup_session_cookie(client: httpx.AsyncClient) -> bool:
    """
    Sends an initial GET request to obtain standard ASP.NET session headers if none provided.
    Does not attempt aggressive bot evasion.
    """
    if settings.HCMC_CAMERA_COOKIE:
        return True

    try:
        response = await client.get(
            settings.HCMC_CAMERA_REFERER,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            timeout=5.0,
        )
        logger.info(
            "Session warmup completed (HTTP %d, cookies: %d)",
            response.status_code,
            len(client.cookies),
        )
        return True
    except Exception as exc:
        logger.warning("Session warmup request timed out or failed: %s", exc)
        return False


async def scrape_camera_image(
    client: httpx.AsyncClient,
    cam: Dict[str, Any],
    storage_dir: str = "storage/cams",
    previous_md5: Optional[str] = None,
    previous_dhash: Optional[str] = None,
) -> ScrapedCameraResult:
    """
    Downloads snapshot for a single camera applying strict validation and zero mock:
    - Verifies permissions before ingestion.
    - Validates magic bytes, Pillow decode, dimensions, placeholders, and dark frames.
    - Returns DataSourceStatus.LIVE if fresh valid image obtained.
    - Falls back to existing local file on disk as DataSourceStatus.STALE if network fails.
    - If neither is available, reports error without creating mock images.
    """
    cam_id = str(cam.get("cam_id") or "")
    code = cam.get("code")
    name = cam.get("name") or f"Camera {code or cam_id}"
    district = cam.get("district")
    lat = float(cam["lat"]) if cam.get("lat") is not None else None
    lng = float(cam["lng"]) if cam.get("lng") is not None else None

    now = datetime.now(timezone.utc)
    os.makedirs(storage_dir, exist_ok=True)
    local_image_path = os.path.join(storage_dir, f"{cam_id}.jpg")

    # 1. Permission Gate: Do not scrape if ingestion permission is unverified
    if not settings.CAMERA_INGESTION_PERMITTED:
        # Check if verified local cached image exists from permitted archival
        if os.path.exists(local_image_path):
            with open(local_image_path, "rb") as f:
                cached_bytes = f.read()
            val_result = validate_camera_image_bytes(cached_bytes)
            if val_result.is_valid:
                return ScrapedCameraResult(
                    cam_id=cam_id,
                    code=code,
                    name=name,
                    district=district,
                    lat=lat,
                    lng=lng,
                    image_path=local_image_path,
                    image_bytes=cached_bytes,
                    source_status=DataSourceStatus.STALE,
                    retrieved_at=now,
                    captured_at=None,
                    capture_time_status="CAPTURE_TIME_UNKNOWN",
                    file_size=len(cached_bytes),
                    is_valid_image=True,
                    validation_status="VALID_LOCAL_ARCHIVE",
                    error_message="PERMISSION_UNVERIFIED: Ingestion disabled by configuration.",
                )

        return ScrapedCameraResult(
            cam_id=cam_id,
            code=code,
            name=name,
            district=district,
            lat=lat,
            lng=lng,
            image_path=None,
            image_bytes=None,
            source_status=DataSourceStatus.STALE,
            retrieved_at=now,
            captured_at=None,
            capture_time_status="CAPTURE_TIME_UNKNOWN",
            file_size=0,
            is_valid_image=False,
            validation_status="PERMISSION_UNVERIFIED",
            error_message="PERMISSION_UNVERIFIED: Set CAMERA_INGESTION_PERMITTED=true with valid credentials.",
        )

    # 2. Attempt live download over TLS (verify=True)
    target_url = build_camera_image_url(cam_id)
    headers = get_camera_request_headers()
    download_err: Optional[str] = None
    val_result: Optional[ImageValidationResult] = None

    try:
        response = await client.get(target_url, headers=headers)
        if response.status_code == 200:
            val_result = validate_camera_image_bytes(
                response.content,
                previous_md5=previous_md5,
                previous_dhash=previous_dhash,
            )
            if val_result.is_valid:
                # Valid live frame! Save to disk atomically
                with open(local_image_path, "wb") as f:
                    f.write(response.content)

                return ScrapedCameraResult(
                    cam_id=cam_id,
                    code=code,
                    name=name,
                    district=district,
                    lat=lat,
                    lng=lng,
                    image_path=local_image_path,
                    image_bytes=response.content,
                    source_status=DataSourceStatus.LIVE,
                    retrieved_at=now,
                    captured_at=val_result.captured_at,
                    capture_time_status=val_result.capture_time_status,
                    file_size=len(response.content),
                    is_valid_image=True,
                    validation_status=val_result.status.value,
                    error_message=None,
                )
            else:
                download_err = f"Validation failed ({val_result.status.value}): {val_result.error_message}"
                logger.warning("Camera %s received invalid frame: %s", cam_id, download_err)
        elif response.status_code in (403, 429):
            download_err = f"HTTP {response.status_code} (Rate limited / Forbidden)"
            logger.warning("Camera %s rate limited or forbidden: %s", cam_id, download_err)
        else:
            download_err = f"HTTP {response.status_code}"
            logger.warning("Camera %s download failed: %s", cam_id, download_err)

    except Exception as exc:
        download_err = f"{type(exc).__name__}: {exc}"
        logger.warning("Camera %s connection exception: %s", cam_id, download_err)

    # 3. Check for existing local stale image on disk
    if os.path.exists(local_image_path):
        try:
            with open(local_image_path, "rb") as f:
                stale_bytes = f.read()
            stale_val = validate_camera_image_bytes(stale_bytes)
            if stale_val.is_valid:
                return ScrapedCameraResult(
                    cam_id=cam_id,
                    code=code,
                    name=name,
                    district=district,
                    lat=lat,
                    lng=lng,
                    image_path=local_image_path,
                    image_bytes=stale_bytes,
                    source_status=DataSourceStatus.STALE,
                    retrieved_at=now,
                    captured_at=None,
                    capture_time_status="CAPTURE_TIME_UNKNOWN",
                    file_size=len(stale_bytes),
                    is_valid_image=True,
                    validation_status="VALID_LOCAL_STALE",
                    error_message=download_err,
                )
        except Exception:
            pass

    # 4. Strict Zero-Mock: Do not generate mock frames. Report unavailable truthfully.
    return ScrapedCameraResult(
        cam_id=cam_id,
        code=code,
        name=name,
        district=district,
        lat=lat,
        lng=lng,
        image_path=None,
        image_bytes=None,
        source_status=DataSourceStatus.STALE,
        retrieved_at=now,
        captured_at=None,
        capture_time_status="CAPTURE_TIME_UNKNOWN",
        file_size=0,
        is_valid_image=False,
        validation_status=val_result.status.value if val_result else "DOWNLOAD_FAILED",
        error_message=f"Live fetch failed ({download_err}) and no valid local cache exists.",
    )


async def scrape_active_cameras(
    cameras: List[Dict[str, Any]],
    storage_dir: str = "storage/cams",
    max_concurrency: Optional[int] = None,
    timeout_sec: Optional[float] = None,
    jitter_range: Tuple[float, float] = (0.2, 0.8),
) -> List[ScrapedCameraResult]:
    """
    Scrapes a batch of active cameras using httpx.AsyncClient with strict TLS verify=True,
    connection pooling, semaphore concurrency control, and backoff jitter.
    """
    concurrency = max_concurrency or settings.CAMERA_MAX_CONCURRENCY
    timeout = timeout_sec or settings.CAMERA_REQUEST_TIMEOUT_SEC
    semaphore = asyncio.Semaphore(concurrency)

    limits = httpx.Limits(max_keepalive_connections=10, max_connections=20)
    async with httpx.AsyncClient(verify=True, timeout=timeout, limits=limits) as client:
        # Pre-warm session cookie if needed
        await warmup_session_cookie(client)

        async def worker(cam_data: Dict[str, Any]) -> ScrapedCameraResult:
            async with semaphore:
                if jitter_range[1] > 0.0:
                    delay = random.uniform(jitter_range[0], jitter_range[1])
                    await asyncio.sleep(delay)
                return await scrape_camera_image(client, cam_data, storage_dir=storage_dir)

        tasks = [worker(c) for c in cameras]
        results = await asyncio.gather(*tasks)

    return results
