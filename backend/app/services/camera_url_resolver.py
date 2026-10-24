"""
SafePathAI Camera URL Resolution Strategy & Adaptive Variant Engine.
Solves the 'IMAGE NOT AVAILABLE' placeholder issue by testing and remembering
the optimal URL variant for each camera ID (Canonical vs. Parameterized vs. Provider).
Enforces TLS verification, strict rate limits, and Zero-Mock image validation.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx
from PIL import Image
from redis.asyncio import Redis

from backend.app.core.config import settings
from backend.app.services.image_validator import validate_camera_image_bytes

logger = logging.getLogger("safepath.url_resolver")

REDIS_URL_STRATEGY_PREFIX = "camera:url_strategy:"
STRATEGY_TTL_SECONDS = 86400  # 24 hours persistence for successful URL strategy


@dataclass
class CameraUrlResolutionResult:
    """Detailed forensic result of camera URL resolution."""
    cam_id: str
    chosen_url: str
    variant_type: str  # CANONICAL, PROVIDER, PARAMETERIZED
    http_status: int
    mime_type: Optional[str] = None
    byte_length: int = 0
    is_valid_image: bool = False
    image_bytes: Optional[bytes] = None
    failure_reason: Optional[str] = None
    content_hash: Optional[str] = None
    dimensions: Optional[Tuple[int, int]] = None
    resolved_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cam_id": self.cam_id,
            "chosen_url": self.chosen_url,
            "variant_type": self.variant_type,
            "http_status": self.http_status,
            "mime_type": self.mime_type,
            "byte_length": self.byte_length,
            "is_valid_image": self.is_valid_image,
            "failure_reason": self.failure_reason,
            "content_hash": self.content_hash,
            "dimensions": list(self.dimensions) if self.dimensions else None,
            "resolved_at": self.resolved_at.isoformat(),
        }


def get_canonical_camera_url(cam_id: str) -> str:
    """Returns the pure canonical URL without query parameter clutter."""
    base = settings.HCMC_CAMERA_BASE_URL.split("?")[0]
    return f"{base}?id={cam_id}"


def get_parameterized_camera_url(cam_id: str) -> str:
    """Returns the legacy parameterized URL variant with dimensions."""
    base = settings.HCMC_CAMERA_BASE_URL.split("?")[0]
    ts_ms = int(time.time() * 1000)
    return f"{base}?id={cam_id}&bg=black&w=300&h=230&t={ts_ms}"


def build_candidate_camera_urls(
    cam_id: str,
    provider_url: Optional[str] = None,
    preferred_variant: Optional[str] = None,
) -> List[Tuple[str, str]]:
    """
    Builds prioritized list of (variant_type, url) candidates to test:
    Priority 1: Previously verified successful variant (if cached)
    Priority 2: Canonical clean URL (CameraHandler.ashx?id=<id>)
    Priority 3: Provider snapshot URL from GIS metadata (if present)
    Priority 4: Parameterized fallback variant
    """
    candidates: List[Tuple[str, str]] = []
    canonical = get_canonical_camera_url(cam_id)
    parameterized = get_parameterized_camera_url(cam_id)

    # If camera has a known historically winning variant, try it first!
    if preferred_variant == "PARAMETERIZED":
        candidates.append(("PARAMETERIZED", parameterized))
        candidates.append(("CANONICAL", canonical))
        if provider_url and provider_url != canonical:
            candidates.append(("PROVIDER", provider_url))
        return candidates

    if preferred_variant == "PROVIDER" and provider_url:
        candidates.append(("PROVIDER", provider_url))
        candidates.append(("CANONICAL", canonical))
        candidates.append(("PARAMETERIZED", parameterized))
        return candidates

    # Default order: Canonical first (solves 'IMAGE NOT AVAILABLE' clutter), then Provider, then Parameterized
    candidates.append(("CANONICAL", canonical))
    if provider_url and provider_url != canonical and provider_url != parameterized:
        candidates.append(("PROVIDER", provider_url))
    candidates.append(("PARAMETERIZED", parameterized))

    return candidates


async def get_cached_preferred_variant(cam_id: str, redis: Optional[Redis] = None) -> Optional[str]:
    """Retrieves proven successful variant from Redis if present."""
    if redis is None:
        return None
    try:
        raw = await redis.get(f"{REDIS_URL_STRATEGY_PREFIX}{cam_id}")
        if raw:
            data = json.loads(raw)
            return data.get("successful_variant")
    except Exception as exc:
        logger.debug("Failed to read URL strategy cache: %s", exc)
    return None


async def save_successful_variant(
    cam_id: str,
    variant_type: str,
    url: str,
    content_hash: Optional[str],
    redis: Optional[Redis] = None,
) -> None:
    """Remembers the winning URL variant in Redis to optimize future requests."""
    if redis is None:
        return
    try:
        payload = json.dumps({
            "cam_id": cam_id,
            "successful_variant": variant_type,
            "successful_url": url,
            "content_hash": content_hash,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        })
        await redis.set(f"{REDIS_URL_STRATEGY_PREFIX}{cam_id}", payload, ex=STRATEGY_TTL_SECONDS)
    except Exception as exc:
        logger.debug("Failed to cache successful URL variant: %s", exc)


async def resolve_camera_image(
    client: httpx.AsyncClient,
    cam_id: str,
    provider_url: Optional[str] = None,
    redis: Optional[Redis] = None,
    request_headers: Optional[Dict[str, str]] = None,
) -> CameraUrlResolutionResult:
    """
    Executes controlled resolution of camera image across candidate variants:
    1. Tries prioritized variant candidates in sequence.
    2. Immediately stops on first valid JPEG frame.
    3. Detects server placeholder error frames (9,230 bytes PNG) and continues to next candidate.
    4. Caches the successful variant to prevent repeated probing.
    """
    now = datetime.now(timezone.utc)
    preferred_variant = await get_cached_preferred_variant(cam_id, redis)
    candidates = build_candidate_camera_urls(cam_id, provider_url, preferred_variant)

    headers = request_headers or {}
    last_res: Optional[CameraUrlResolutionResult] = None

    for variant_type, url in candidates:
        try:
            resp = await client.get(url, headers=headers)
            content = resp.content
            status = resp.status_code
            mime = resp.headers.get("content-type")
            byte_len = len(content)

            # Strict Zero-Mock validation
            if status == 200 and content:
                val = validate_camera_image_bytes(content)
            else:
                from backend.app.services.image_validator import ImageValidationResult, ImageValidationStatus
                val = ImageValidationResult(
                    status=ImageValidationStatus.CORRUPTED_PAYLOAD,
                    is_valid=False,
                    format=None,
                    width=None,
                    height=None,
                    file_size_bytes=byte_len,
                    md5_hash="",
                    dhash=None,
                    mean_intensity=None,
                    captured_at=None,
                    capture_time_status="CAPTURE_TIME_UNKNOWN",
                    retrieved_at=datetime.now(timezone.utc),
                    error_message=f"HTTP {status}",
                )
            content_hash = hashlib.md5(content).hexdigest() if content else None

            # Attempt dimension decoding with Pillow if valid
            dims: Optional[Tuple[int, int]] = None
            if val.is_valid and content:
                try:
                    with Image.open(io.BytesIO(content)) as img:
                        dims = img.size
                except Exception:
                    pass

            result = CameraUrlResolutionResult(
                cam_id=cam_id,
                chosen_url=url,
                variant_type=variant_type,
                http_status=status,
                mime_type=mime,
                byte_length=byte_len,
                is_valid_image=val.is_valid,
                image_bytes=content if val.is_valid else None,
                failure_reason=val.error_message or val.status.value if not val.is_valid else None,
                content_hash=content_hash,
                dimensions=dims,
                resolved_at=now,
            )

            # If this variant returned a valid camera frame, success!
            if val.is_valid:
                logger.info(
                    "Camera %s resolved with %s variant (%d bytes, %s)",
                    cam_id[:8], variant_type, byte_len, dims,
                )
                await save_successful_variant(cam_id, variant_type, url, content_hash, redis)
                return result

            last_res = result

            # If server returned HTTP 403 or 429, don't keep bombarding
            if status in (403, 429):
                logger.warning("Camera %s received HTTP %d on %s, stopping candidates.", cam_id[:8], status, variant_type)
                break

        except Exception as exc:
            logger.debug("Candidate %s failed for cam %s: %s", variant_type, cam_id[:8], exc)
            last_res = CameraUrlResolutionResult(
                cam_id=cam_id,
                chosen_url=url,
                variant_type=variant_type,
                http_status=0,
                is_valid_image=False,
                failure_reason=f"Connection error: {str(exc)[:100]}",
                resolved_at=now,
            )

    # If all candidates failed or returned placeholder
    if last_res is None:
        canonical_url = get_canonical_camera_url(cam_id)
        last_res = CameraUrlResolutionResult(
            cam_id=cam_id,
            chosen_url=canonical_url,
            variant_type="CANONICAL",
            http_status=0,
            is_valid_image=False,
            failure_reason="No URL candidate could be resolved",
            resolved_at=now,
        )

    return last_res
