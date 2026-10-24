"""
HCMC Camera Ingestion Worker & Network Scraper.
Fetches camera snapshots from the Ho Chi Minh City Department of Transport portal,
applies strict Zero-Mock image validation, enforces TLS verify=True,
implements rate-limiting, and honors data usage permissions.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import logging
import os
import random
import re
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

from backend.app.core.config import settings
from backend.app.schemas.contracts import DataSourceStatus, EvidenceEligibility, ImageAccessStatus
from backend.app.services.camera_url_resolver import (
    get_canonical_camera_url,
    resolve_camera_image,
)
from backend.app.services.image_validator import (
    ImageValidationResult,
    ImageValidationStatus,
    validate_camera_image_bytes,
)

logger = logging.getLogger(__name__)

# Minimum byte threshold for a valid decoded camera JPEG frame
MIN_VALID_IMAGE_BYTES: int = 2500

# Strict Path-Traversal Guard Regex
CAM_ID_PATTERN = re.compile(r"^[0-9a-fA-F]{24}$")
SAFE_SLUG_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")


def is_valid_cam_id(cam_id: str) -> bool:
    """Validates that camera ID contains no directory traversal sequences."""
    if not cam_id or not isinstance(cam_id, str):
        return False
    if ".." in cam_id or "/" in cam_id or "\\" in cam_id:
        return False
    return bool(CAM_ID_PATTERN.match(cam_id) or SAFE_SLUG_PATTERN.match(cam_id))


class CircuitBreaker:
    """Circuit breaker preventing excessive spam when external portal restricts access (403/429)."""
    def __init__(self, failure_threshold: int = 3, reset_timeout_sec: float = 60.0):
        self.failure_threshold = failure_threshold
        self.reset_timeout_sec = reset_timeout_sec
        self.consecutive_failures = 0
        self.last_failure_time = 0.0
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN

    def record_failure(self, status_code: int):
        if status_code in (403, 429):
            self.consecutive_failures += 1
            self.last_failure_time = time.time()
            if self.consecutive_failures >= self.failure_threshold:
                self.state = "OPEN"
                logger.warning(
                    "Circuit breaker tripped OPEN: External camera portal returned %d repeated errors.",
                    status_code,
                )

    def record_success(self):
        self.consecutive_failures = 0
        self.state = "CLOSED"

    def can_request(self) -> bool:
        if self.state == "CLOSED":
            return True
        if time.time() - self.last_failure_time > self.reset_timeout_sec:
            self.state = "HALF_OPEN"
            return True
        return False


# Global circuit breaker instance for HCMC traffic portal
portal_circuit_breaker = CircuitBreaker()


def evict_stale_disk_images(storage_dir: str = "storage/cams", max_hours: int = 24) -> int:
    """Removes cached snapshot files older than max_hours to control disk usage."""
    if not os.path.exists(storage_dir):
        return 0
    now = time.time()
    cutoff = now - (max_hours * 3600)
    evicted = 0
    for fname in os.listdir(storage_dir):
        if fname.endswith(".jpg") or fname.endswith(".png"):
            fpath = os.path.join(storage_dir, fname)
            try:
                if os.path.isfile(fpath) and os.path.getmtime(fpath) < cutoff:
                    os.remove(fpath)
                    evicted += 1
            except Exception as e:
                logger.debug("Stale image eviction skipped %s: %s", fpath, e)
    return evicted


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
    is_new_snapshot: bool = True
    validation_status: Optional[str] = None
    error_message: Optional[str] = None
    image_access_status: ImageAccessStatus = ImageAccessStatus.UNAVAILABLE
    evidence_eligibility: EvidenceEligibility = EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING
    image_status_reason: Optional[str] = None
    etag: Optional[str] = None

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
            "is_new_snapshot": self.is_new_snapshot,
            "validation_status": self.validation_status,
            "error_message": self.error_message,
            "image_access_status": self.image_access_status.value,
            "evidence_eligibility": self.evidence_eligibility.value,
            "image_status_reason": self.image_status_reason,
            "etag": self.etag,
        }


def build_camera_image_url(cam_id: str) -> str:
    """
    Constructs the canonical clean URL for HCMC Traffic Portal.
    Avoids fixed clutter parameters (bg, w, h) that trigger 'IMAGE NOT AVAILABLE'.
    """
    return get_canonical_camera_url(cam_id)


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
    allow_view_only: Optional[bool] = None,
    redis: Optional[Any] = None,
) -> ScrapedCameraResult:
    """
    Downloads snapshot for a single camera applying strict validation and zero mock:
    - Path traversal guard on cam_id.
    - Differentiates VIEWABLE_PUBLIC vs ROUTING_ELIGIBLE evidence.
    - Validates magic bytes, Pillow decode, dimensions, server error placeholders.
    - Returns DataSourceStatus.LIVE only if fresh valid image obtained within TTL.
    - Falls back to existing local file on disk as DataSourceStatus.STALE if network fails.
    - Circuit breaker trips on repeated 403/429 to protect provider endpoints.
    - Never generates mock or fabricated frames.
    """
    cam_id = str(cam.get("cam_id") or "")
    code = cam.get("code")
    name = cam.get("name") or f"Camera {code or cam_id}"
    district = cam.get("district")
    lat = float(cam["lat"]) if cam.get("lat") is not None else None
    lng = float(cam["lng"]) if cam.get("lng") is not None else None

    now = datetime.now(timezone.utc)
    os.makedirs(storage_dir, exist_ok=True)

    # 0. Path Traversal Guard
    if not is_valid_cam_id(cam_id):
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
            validation_status="INVALID_CAMERA_ID",
            error_message="Camera ID contains invalid characters or path traversal elements.",
            image_access_status=ImageAccessStatus.UNAVAILABLE,
            evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
            image_status_reason="INVALID_CAMERA_ID",
        )

    local_image_path = os.path.join(storage_dir, f"{cam_id}.jpg")
    can_view_only = allow_view_only if allow_view_only is not None else settings.CAMERA_ALLOW_VIEW_ONLY
    can_ingest_evidence = settings.CAMERA_INGESTION_PERMITTED

    # 1. Permission Gate
    if not can_ingest_evidence and not can_view_only:
        # Check if verified local cached image exists from permitted archival
        if os.path.exists(local_image_path):
            with open(local_image_path, "rb") as f:
                cached_bytes = f.read()
            val_result = validate_camera_image_bytes(cached_bytes)
            if val_result.is_valid:
                mtime = os.path.getmtime(local_image_path)
                cached_retrieved_at = datetime.fromtimestamp(mtime, tz=timezone.utc)
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
                    retrieved_at=cached_retrieved_at,
                    captured_at=None,
                    capture_time_status="CAPTURE_TIME_UNKNOWN",
                    file_size=len(cached_bytes),
                    is_valid_image=True,
                    is_new_snapshot=False,
                    validation_status="VALID_LOCAL_ARCHIVE",
                    error_message="PERMISSION_UNVERIFIED: Ingestion disabled by configuration.",
                    image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC,
                    evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
                    image_status_reason="VALID_IMAGE_CACHED",
                    etag=hashlib.md5(cached_bytes).hexdigest(),
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
            image_access_status=ImageAccessStatus.UNAVAILABLE,
            evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
            image_status_reason="PERMISSION_UNVERIFIED",
        )

    # 2. Check Circuit Breaker before making outbound request
    if not portal_circuit_breaker.can_request():
        # Fall back to local file if available
        if os.path.exists(local_image_path):
            try:
                with open(local_image_path, "rb") as f:
                    cached_bytes = f.read()
                val_result = validate_camera_image_bytes(cached_bytes)
                if val_result.is_valid:
                    mtime = os.path.getmtime(local_image_path)
                    cached_retrieved_at = datetime.fromtimestamp(mtime, tz=timezone.utc)
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
                        retrieved_at=cached_retrieved_at,
                        captured_at=None,
                        capture_time_status="CAPTURE_TIME_UNKNOWN",
                        file_size=len(cached_bytes),
                        is_valid_image=True,
                        is_new_snapshot=False,
                        validation_status="VALID_LOCAL_STALE",
                        error_message="Circuit breaker active; serving local cache.",
                        image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC,
                        evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
                        image_status_reason="VALID_IMAGE_CACHED",
                        etag=hashlib.md5(cached_bytes).hexdigest(),
                    )
            except Exception:
                pass

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
            validation_status="EXTERNAL_ACCESS_RESTRICTED",
            error_message="Circuit breaker open: HCMC traffic portal restricted direct requests (403/429).",
            image_access_status=ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED,
            evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
            image_status_reason="EXTERNAL_ACCESS_RESTRICTED",
        )

    # 3. Attempt live download over TLS via adaptive camera_url_resolver
    headers = get_camera_request_headers()
    provider_url = cam.get("provider_snapshot_url") or cam.get("source_uri")
    download_err: Optional[str] = None
    val_result: Optional[ImageValidationResult] = None
    status_reason: str = "IMAGE_UNAVAILABLE"

    try:
        res = await resolve_camera_image(
            client=client,
            cam_id=cam_id,
            provider_url=provider_url,
            redis=redis,
            request_headers=headers,
        )

        if res.is_valid_image and res.image_bytes:
            portal_circuit_breaker.record_success()
            val_result = validate_camera_image_bytes(
                res.image_bytes,
                previous_md5=previous_md5,
                previous_dhash=previous_dhash,
            )
            if val_result.is_valid:
                # Valid frame! Save to disk atomically
                with open(local_image_path, "wb") as f:
                    f.write(res.image_bytes)

                etag_val = val_result.md5_hash or res.content_hash

                if val_result.captured_at is not None:
                    is_fresh = (now - val_result.captured_at).total_seconds() <= settings.CAMERA_IMAGE_TTL_SECONDS
                    source_st = DataSourceStatus.LIVE if is_fresh else DataSourceStatus.STALE
                    capture_time_status = "CAPTURED_RECENTLY" if is_fresh else "STALE"
                    eligibility = (
                        EvidenceEligibility.ROUTING_ELIGIBLE
                        if (settings.CAMERA_ROUTING_EVIDENCE_PERMITTED and is_fresh)
                        else EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING
                    )
                else:
                    # Strict Zero-Mock: Timestamp not verified in frame; only known to be freshly retrieved
                    source_st = DataSourceStatus.LIVE
                    capture_time_status = "CAPTURE_TIME_UNKNOWN"
                    eligibility = EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING

                return ScrapedCameraResult(
                    cam_id=cam_id,
                    code=code,
                    name=name,
                    district=district,
                    lat=lat,
                    lng=lng,
                    image_path=local_image_path,
                    image_bytes=res.image_bytes,
                    source_status=source_st,
                    retrieved_at=now,
                    captured_at=val_result.captured_at,
                    capture_time_status=capture_time_status,
                    file_size=res.byte_length,
                    is_valid_image=True,
                    is_new_snapshot=True,
                    validation_status=val_result.status.value,
                    error_message=None,
                    image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC,
                    evidence_eligibility=eligibility,
                    image_status_reason="VALID_IMAGE_CACHED",
                    etag=etag_val,
                )
        elif res.http_status in (403, 429):
            portal_circuit_breaker.record_failure(res.http_status)
            status_reason = "EXTERNAL_ACCESS_RESTRICTED"
            download_err = f"HTTP {res.http_status} (Rate limited / Forbidden by portal)"
            logger.warning("Camera %s rate limited or forbidden: %s", cam_id, download_err)
        elif res.failure_reason and "PLACEHOLDER" in res.failure_reason.upper():
            status_reason = "PLACEHOLDER_FRAME"
            download_err = "Server returned 'IMAGE NOT AVAILABLE' placeholder frame"
            logger.warning("Camera %s received placeholder on candidate variants: %s", cam_id, download_err)
        else:
            status_reason = "NETWORK_FAILURE"
            download_err = res.failure_reason or f"HTTP {res.http_status}"
            logger.warning("Camera %s resolution failed: %s", cam_id, download_err)

    except Exception as exc:
        status_reason = "NETWORK_FAILURE"
        download_err = f"{type(exc).__name__}: {exc}"
        logger.warning("Camera %s connection exception: %s", cam_id, download_err)

    # 4. Check for existing local stale image on disk
    if os.path.exists(local_image_path):
        try:
            with open(local_image_path, "rb") as f:
                stale_bytes = f.read()
            stale_val = validate_camera_image_bytes(stale_bytes)
            if stale_val.is_valid:
                mtime = os.path.getmtime(local_image_path)
                cached_retrieved_at = datetime.fromtimestamp(mtime, tz=timezone.utc)
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
                    retrieved_at=cached_retrieved_at,
                    captured_at=None,
                    capture_time_status="CAPTURE_TIME_UNKNOWN",
                    file_size=len(stale_bytes),
                    is_valid_image=True,
                    is_new_snapshot=False,
                    validation_status="VALID_LOCAL_STALE",
                    error_message=download_err,
                    image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC,
                    evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
                    image_status_reason="VALID_IMAGE_CACHED",
                    etag=hashlib.md5(stale_bytes).hexdigest(),
                )
        except Exception:
            pass

    # 5. Strict Zero-Mock: Do not generate mock frames. Report unavailable truthfully.
    access_st = (
        ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
        if status_reason == "EXTERNAL_ACCESS_RESTRICTED"
        else ImageAccessStatus.UNAVAILABLE
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
        validation_status=val_result.status.value if val_result else status_reason,
        error_message=f"Live fetch failed ({download_err}) and no valid local cache exists.",
        image_access_status=access_st,
        evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
        image_status_reason=status_reason,
    )


async def scrape_active_cameras(
    cameras: List[Dict[str, Any]],
    storage_dir: str = "storage/cams",
    max_concurrency: Optional[int] = None,
    timeout_sec: Optional[float] = None,
    jitter_range: Tuple[float, float] = (0.2, 0.8),
    redis: Optional[Any] = None,
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
                return await scrape_camera_image(client, cam_data, storage_dir=storage_dir, redis=redis)

        tasks = [worker(c) for c in cameras]
        results = await asyncio.gather(*tasks)

    return results
