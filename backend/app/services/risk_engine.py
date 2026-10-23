"""
Risk Engine for OpenStreetMap Road Segments (Zero-Mock Runtime).
Calculates deterministic multi-criteria risk scores based strictly on:
1. Verified, fresh camera observations showing the exact road segment.
2. Official historical flood points combined with real-time precipitation and tidal alerts.
3. Strict Zero-Mock: Without verified evidence, roads are marked UNKNOWN, never defaulted to SAFE.
"""

from datetime import datetime, timezone
import json
import logging
import math
from typing import Any, Dict, List, Optional, Union
from redis.asyncio import Redis

from backend.app.db.models import RoadEdge, RoadSegment
from backend.app.db.session import get_redis_client
from backend.app.schemas.contracts import (
    CameraEvidence,
    DataSourceStatus,
    EvidenceEligibility,
    RiskLevel,
    RouteSegmentRisk,
    WeatherTideSignal,
)

logger = logging.getLogger(__name__)

# Redis key prefix for segment risk caching
REDIS_SEGMENT_RISK_PREFIX = "road:risk:"

# Risk Level Score Boundaries
CRITICAL_RISK_THRESHOLD = 65.0
MODERATE_RISK_THRESHOLD = 30.0

# Critical Camera Flood Threshold (>= 35% road water segmentation triggers automatic CRITICAL)
AUTO_CRITICAL_FLOOD_RATIO = 0.35

# Rain Intensity Thresholds (mm/h)
HEAVY_RAIN_THRESHOLD_MM_H = 30.0
MODERATE_RAIN_THRESHOLD_MM_H = 10.0


def calculate_segment_risk(
    segment: Union[RoadEdge, RoadSegment, Dict[str, Any]],
    camera_evidences: List[CameraEvidence],
    weather_tide: Optional[WeatherTideSignal] = None,
) -> RouteSegmentRisk:
    """
    Calculates the multi-criteria risk assessment for a specific OSM road segment or edge.
    
    Zero-Mock Principles:
    - Only cameras with OBSERVED_SEGMENT_VERIFIED and fresh LIVE status can provide camera scoring.
      Spatially near cameras without verified view orientation cannot score the road.
    - Historical flood points and regional weather are context, not a current
      measurement of water on this exact road segment.
    - If a segment has no verified camera observations and is not flood-prone:
        - Returns RiskLevel.UNKNOWN with risk_score = None.
    """
    # Extract segment properties
    if isinstance(segment, RoadEdge):
        osm_way_id = segment.osm_way_id
        edge_index = segment.edge_index
        street_name = segment.way.street_name if segment.way else None
        length_meters = segment.length_meters
        source_url = segment.way.source_url if segment.way else None
        is_flood_prone_history = getattr(segment.way, "is_flood_prone_history", None) if segment.way else None
    elif isinstance(segment, RoadSegment):
        osm_way_id = segment.osm_way_id
        edge_index = None
        street_name = segment.street_name
        length_meters = segment.length_meters
        source_url = segment.source_url
        is_flood_prone_history = segment.is_flood_prone_history
    elif isinstance(segment, dict):
        osm_way_id = segment.get("osm_way_id")
        edge_index = segment.get("edge_index", segment.get("osm_edge_index"))
        street_name = segment.get("street_name")
        length_meters = segment.get("length_meters")
        source_url = segment.get("source_url")
        is_flood_prone_history = segment.get("is_flood_prone_history", segment.get("historical_flood_prone"))
    else:
        osm_way_id = getattr(segment, "osm_way_id", None)
        edge_index = getattr(segment, "edge_index", getattr(segment, "osm_edge_index", None))
        street_name = getattr(segment, "street_name", None)
        length_meters = getattr(segment, "length_meters", None)
        source_url = getattr(segment, "source_url", None)
        is_flood_prone_history = getattr(segment, "is_flood_prone_history", getattr(segment, "historical_flood_prone", None))

    try:
        measured_length = float(length_meters)
    except (TypeError, ValueError):
        measured_length = 0.0

    if (not osm_way_id or not math.isfinite(measured_length) or measured_length <= 0):
        raise ValueError("Risk scoring requires a valid OSM way and positive measured length")

    now = datetime.now(timezone.utc)

    # 1. Filter strictly verified camera observations
    verified_cams = [
        cam for cam in camera_evidences
        if cam.spatial_match_status == "OBSERVED_SEGMENT_VERIFIED"
        and cam.observed_osm_way_id == osm_way_id
        and (edge_index is None or cam.observed_edge_index == edge_index or cam.observed_edge_index is None)
        and cam.coordinate_source_url
        and cam.view_verification_source_url
        and cam.line_of_sight_verified
        and cam.evidence_eligibility == EvidenceEligibility.ROUTING_ELIGIBLE
        and (cam.source_status == DataSourceStatus.LIVE or cam.source_status.value == "LIVE")
        and cam.updated_at.tzinfo is not None
        and 0 <= (now - cam.updated_at).total_seconds() <= 120
    ]

    camera_risk_score: Optional[float] = None
    severe_camera_flood = False
    freshness_seconds: Optional[float] = None

    cams_with_metrics = [c for c in verified_cams if c.flood_ratio is not None and c.traffic_density_score is not None]
    if cams_with_metrics:
        camera_risk_score = round(
            max(cam.flood_ratio * 75.0 + cam.traffic_density_score * 25.0 for cam in cams_with_metrics),
            2,
        )
        severe_camera_flood = any(cam.flood_ratio >= AUTO_CRITICAL_FLOOD_RATIO for cam in cams_with_metrics)

    if verified_cams:
        freshness_seconds = min((now - cam.updated_at).total_seconds() for cam in verified_cams)

    # 2. Evaluate Weather & Tide inputs
    weather_risk: Optional[str] = None
    rain_mm: Optional[float] = None
    tide_alert: Optional[bool] = None

    if weather_tide is not None:
        rain_observed = weather_tide.rain_observed_at
        rain_fresh = (
            weather_tide.rain_status == "LIVE" and weather_tide.source_url
            and rain_observed is not None and rain_observed.tzinfo is not None
            and 0 <= (now - rain_observed).total_seconds() <= 900
        )
        rain_mm = weather_tide.rain_mm_per_hour if rain_fresh else None
        tide_observed = weather_tide.timestamp
        tide_fresh = (
            weather_tide.tide_status == "LIVE" and weather_tide.source_url
            and tide_observed is not None and tide_observed.tzinfo is not None
            and 0 <= (now - tide_observed).total_seconds() <= 10800
        )
        tide_alert = weather_tide.is_high_tide_alert if tide_fresh else None

        if rain_mm is not None:
            if rain_mm >= HEAVY_RAIN_THRESHOLD_MM_H:
                weather_risk = "HEAVY_RAIN"
            elif rain_mm >= MODERATE_RAIN_THRESHOLD_MM_H:
                weather_risk = "MODERATE_RAIN"
            elif rain_mm > 0.0:
                weather_risk = "LIGHT_RAIN"
            else:
                weather_risk = "CLEAR"
        else:
            weather_risk = "UNKNOWN"

        if freshness_seconds is None and rain_fresh:
            freshness_seconds = (now - rain_observed).total_seconds()

    # 3. Determine Risk Level and Multi-Criteria Score
    risk_level = RiskLevel.UNKNOWN
    final_score: Optional[float] = None

    # Case A: Severe camera flood detected right now
    if severe_camera_flood:
        risk_level = RiskLevel.CRITICAL
        final_score = max(camera_risk_score or 0.0, 75.0)

    # A camera can show a current hazard. A low score at one view cannot
    # establish that the entire road segment is safe.
    elif camera_risk_score is not None:
        if camera_risk_score >= CRITICAL_RISK_THRESHOLD:
            risk_level = RiskLevel.CRITICAL
            final_score = camera_risk_score
        elif camera_risk_score >= MODERATE_RISK_THRESHOLD:
            risk_level = RiskLevel.MODERATE
            final_score = camera_risk_score

    # Case D: No verified camera, no active flood history match
    else:
        # Unobserved road segment
        risk_level = RiskLevel.UNKNOWN
        final_score = None

    # Determine evidence coverage description
    if verified_cams:
        evidence_coverage = "OBSERVED_SEGMENT_VERIFIED"
    elif camera_evidences:
        evidence_coverage = "SPATIALLY_NEAR_UNVERIFIED_VIEW"
    else:
        evidence_coverage = "NO_VERIFIED_OBSERVATIONS"

    return RouteSegmentRisk(
        osm_way_id=osm_way_id,
        osm_edge_index=edge_index,
        street_name=street_name,
        length_meters=measured_length,
        risk_score=final_score,
        risk_level=risk_level,
        historical_flood_prone=is_flood_prone_history,
        historical_flood_cause="TIDAL_AND_HEAVY_RAIN" if (is_flood_prone_history and tide_alert) else ("HEAVY_RAIN" if is_flood_prone_history else None),
        weather_risk=weather_risk,
        evidence_coverage=evidence_coverage,
        evidence_cameras=verified_cams,
        freshness_seconds=freshness_seconds,
    )


async def save_segment_risk_to_redis(
    segment_risk: RouteSegmentRisk,
    redis_client: Optional[Redis] = None,
    ttl_seconds: int = 600,
) -> None:
    """
    Caches verified segment risk under road:risk:{osm_way_id}:{edge_index or 'all'}.
    """
    close_redis = False
    if segment_risk.osm_way_id is None:
        return
    if redis_client is None:
        redis_client = get_redis_client()
        close_redis = True

    try:
        edge_sub = segment_risk.osm_edge_index if segment_risk.osm_edge_index is not None else "all"
        key = f"{REDIS_SEGMENT_RISK_PREFIX}{segment_risk.osm_way_id}:{edge_sub}"
        payload = segment_risk.model_dump_json()
        await redis_client.set(key, payload, ex=ttl_seconds)
    except Exception as exc:
        logger.warning("Failed to cache road segment risk for %s in Redis: %s", segment_risk.osm_way_id, exc)
    finally:
        if close_redis:
            await redis_client.aclose()


async def get_cached_segment_risk(
    osm_way_id: int,
    redis_client: Optional[Redis] = None,
    edge_index: Optional[int] = None,
) -> Optional[RouteSegmentRisk]:
    """
    Retrieves cached RouteSegmentRisk from Redis.
    """
    close_redis = False
    if redis_client is None:
        redis_client = get_redis_client()
        close_redis = True

    try:
        edge_sub = edge_index if edge_index is not None else "all"
        key = f"{REDIS_SEGMENT_RISK_PREFIX}{osm_way_id}:{edge_sub}"
        raw_val = await redis_client.get(key)
        if not raw_val:
            return None
        data = json.loads(raw_val)
        return RouteSegmentRisk.model_validate(data)
    except Exception as exc:
        logger.warning("Failed to get cached segment risk for %s: %s", osm_way_id, exc)
        return None
    finally:
        if close_redis:
            await redis_client.aclose()
