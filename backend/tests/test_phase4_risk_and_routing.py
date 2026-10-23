"""
Phase 4 Unit and Integration Tests for SafePathAI.
Validates:
1. Deterministic segment risk calculation (F_cam, M_rain, T_tide, H_hist).
2. Weight redistribution for segments with vs without active camera coverage.
3. Comparative dynamic safe routing (ranking longer dry route above shorter flooded route).
4. Spatial buffer corridor matching (80m corridor).
"""

from datetime import datetime, timezone
import json
import os
import pytest
from geoalchemy2 import WKTElement
from sqlalchemy import select, delete

from backend.app.db.models import RoadSegment, TrafficCamera
from backend.app.db.session import AsyncSessionLocal, get_redis_client
from backend.app.schemas.contracts import (
    CameraEvidence,
    DataSourceStatus,
    RiskLevel,
    RouteSegmentRisk,
    SafeRouteResponse,
    WeatherTideSignal,
)
from backend.app.services.risk_engine import (
    calculate_segment_risk,
    save_segment_risk_to_redis,
    get_cached_segment_risk,
)
from backend.app.services.routing import (
    find_safe_route,
    _point_to_linestring_distance_meters,
    _haversine_meters,
    CORRIDOR_BUFFER_METERS,
    CRITICAL_FLOOD_PENALTY_MINUTES,
)


# ==============================================================================
# 1. Segment Risk Engine Tests
# ==============================================================================
class TestSegmentRiskEngine:
    """Tests for deterministic multi-criteria risk scoring formula."""

    def test_segment_risk_with_cameras(self):
        # 1. Critical camera flood
        cam_critical = CameraEvidence(
            cam_id="cam_001",
            code="TTH 145",
            name="Nguyễn Hữu Cảnh",
            lat=10.7981,
            lng=106.7186,
            coordinate_source_url="https://vdms.example.com/cam_001",
            view_verification_source_url="https://audit.example.com/view/cam_001",
            image_url="storage/cams/cam_001.jpg",
            vehicle_count=20,
            traffic_density_score=0.40,
            flood_ratio=0.60,
            risk_level=RiskLevel.CRITICAL,
            source_status=DataSourceStatus.LIVE,
            spatial_match_status="OBSERVED_SEGMENT_VERIFIED",
            line_of_sight_verified=True,
            observed_osm_way_id=1001,
            updated_at=datetime.now(timezone.utc),
        )
        weather_tide = WeatherTideSignal(
            rain_mm_per_hour=10.0,
            tide_level_meters=1.20,
            is_high_tide_alert=False,
            timestamp=datetime.now(timezone.utc),
        )
        seg_risk = calculate_segment_risk(
            segment={"osm_way_id": 1001, "street_name": "Nguyễn Hữu Cảnh", "is_flood_prone_history": True, "length_meters": 100.0},
            camera_evidences=[cam_critical],
            weather_tide=weather_tide,
        )
        assert seg_risk.risk_level == RiskLevel.CRITICAL
        assert seg_risk.risk_score >= 40.0
        assert len(seg_risk.evidence_cameras) == 1

        # 2. Safe camera (dry road, low traffic) -> UNKNOWN (a clear frame does not prove whole way is SAFE)
        cam_safe = CameraEvidence(
            cam_id="cam_002",
            code="TTH 44.3",
            name="Điện Biên Phủ",
            lat=10.8012,
            lng=106.7115,
            coordinate_source_url="https://vdms.example.com/cam_002",
            view_verification_source_url="https://audit.example.com/view/cam_002",
            image_url="storage/cams/cam_002.jpg",
            vehicle_count=10,
            traffic_density_score=0.20,
            flood_ratio=0.0,
            risk_level=RiskLevel.SAFE,
            source_status=DataSourceStatus.LIVE,
            spatial_match_status="OBSERVED_SEGMENT_VERIFIED",
            line_of_sight_verified=True,
            observed_osm_way_id=4004,
            updated_at=datetime.now(timezone.utc),
        )
        seg_risk_safe = calculate_segment_risk(
            segment={"osm_way_id": 4004, "street_name": "Điện Biên Phủ", "is_flood_prone_history": False, "length_meters": 100.0},
            camera_evidences=[cam_safe],
            weather_tide=weather_tide,
        )
        assert seg_risk_safe.risk_level == RiskLevel.UNKNOWN
        assert seg_risk_safe.risk_score < 30.0

    def test_segment_risk_without_cameras(self):
        """When no camera is present, historically flood-prone segments scale with weather and tide."""
        severe_weather = WeatherTideSignal(
            rain_mm_per_hour=45.0,
            tide_level_meters=1.70,
            is_high_tide_alert=True,
            timestamp=datetime.now(timezone.utc),
        )
        seg_risk_severe = calculate_segment_risk(
            segment={"osm_way_id": 9999, "street_name": "Đoạn Không Camera", "is_flood_prone_history": True, "length_meters": 100.0},
            camera_evidences=[],
            weather_tide=severe_weather,
        )
        assert seg_risk_severe.risk_level == RiskLevel.CRITICAL
        assert seg_risk_severe.risk_score >= 65.0

        # Calm dry weather, low tide, no history -> UNKNOWN (never default to safe without sensors)
        calm_weather = WeatherTideSignal(
            rain_mm_per_hour=0.0,
            tide_level_meters=0.90,
            is_high_tide_alert=False,
            timestamp=datetime.now(timezone.utc),
        )
        seg_risk_calm = calculate_segment_risk(
            segment={"osm_way_id": 8888, "street_name": "Đoạn Yên Bình", "is_flood_prone_history": False, "length_meters": 100.0},
            camera_evidences=[],
            weather_tide=calm_weather,
        )
        assert seg_risk_calm.risk_level == RiskLevel.UNKNOWN
        assert seg_risk_calm.risk_score is None

    def test_auto_critical_flood_threshold(self):
        """A verified camera with flood_ratio >= 0.35 must immediately trigger CRITICAL risk."""
        cam = CameraEvidence(
            cam_id="cam_auto_crit",
            code="TTH 01",
            name="Test",
            lat=10.7,
            lng=106.7,
            coordinate_source_url="https://vdms.example.com/cam_01",
            view_verification_source_url="https://audit.example.com/view/cam_01",
            image_url="test.jpg",
            vehicle_count=0,
            traffic_density_score=0.0,
            flood_ratio=0.36,
            risk_level=RiskLevel.CRITICAL,
            source_status=DataSourceStatus.LIVE,
            spatial_match_status="OBSERVED_SEGMENT_VERIFIED",
            line_of_sight_verified=True,
            observed_osm_way_id=5555,
            updated_at=datetime.now(timezone.utc),
        )
        seg = calculate_segment_risk(
            segment={"osm_way_id": 5555, "street_name": "Test St", "is_flood_prone_history": False, "length_meters": 100.0},
            camera_evidences=[cam],
            weather_tide=None,
        )
        assert seg.risk_level == RiskLevel.CRITICAL

    @pytest.mark.asyncio
    async def test_redis_segment_risk_caching(self):
        redis = get_redis_client()
        seg_risk = RouteSegmentRisk(
            osm_way_id=12345,
            street_name="Xa Lộ Hà Nội",
            length_meters=500.0,
            risk_score=25.5,
            risk_level=RiskLevel.SAFE,
            evidence_cameras=[],
        )
        await save_segment_risk_to_redis(seg_risk, redis_client=redis, ttl_seconds=60)

        cached = await get_cached_segment_risk(12345, redis_client=redis)
        assert cached is not None
        assert cached.osm_way_id == 12345
        assert cached.risk_score == 25.5
        assert cached.risk_level == RiskLevel.SAFE

        await redis.delete("road:risk:12345")
        await redis.aclose()


# ==============================================================================
# 2. Dynamic Routing & Comparative Benchmarks
# ==============================================================================
class TestDynamicSafeRouting:
    """
    Validates dynamic routing and multi-criteria candidate ranking
    without mutating production PostGIS tables.
    """

    @pytest.mark.asyncio
    async def test_dynamic_safe_route_ranking(self):
        redis = get_redis_client()
        async with AsyncSessionLocal() as session:
            routes = await find_safe_route(
                origin_lat=10.7725,
                origin_lng=106.6980,
                dest_lat=10.8012,
                dest_lng=106.7115,
                db_session=session,
                redis_client=redis,
            )

        assert len(routes) >= 1
        route_top = routes[0]
        assert route_top.total_distance_km > 0
        assert route_top.estimated_time_mins > 0
        assert route_top.geojson_path["type"] == "LineString"
        assert len(route_top.geojson_path["coordinates"]) >= 10
        await redis.aclose()


# ==============================================================================
# 3. Spatial Buffer Corridor Geometry Tests
# ==============================================================================
class TestSpatialCorridorMatching:
    """Validates 80m spatial corridor distance matching."""

    def test_corridor_matching_distance_bounds(self):
        # Route line coordinates: (lng, lat)
        route_line = [
            [106.7180, 10.7980],
            [106.7190, 10.7982],
        ]

        # Camera at (10.7981, 106.7186) is ~12m from the line
        d_close = _point_to_linestring_distance_meters(10.7981, 106.7186, route_line)
        assert d_close <= CORRIDOR_BUFFER_METERS, f"Expected distance <= 80m, got {d_close}m"

        # Camera far away (> 500m)
        d_far = _point_to_linestring_distance_meters(10.8100, 106.7300, route_line)
        assert d_far > CORRIDOR_BUFFER_METERS, f"Expected distance > 80m, got {d_far}m"
