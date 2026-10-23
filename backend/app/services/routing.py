"""OSRM driving candidates and evidence coverage for Ho Chi Minh City."""

import json
import hashlib
import logging
import math
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional, Set, Union

import httpx
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.schemas.contracts import (
    CameraEvidence,
    DataSourceStatus,
    EvidenceEligibility,
    ImageAccessStatus,
    RiskLevel,
    RouteSegmentRisk,
    SafeRouteResponse,
    WeatherTideSignal,
)
from backend.app.services.weather_tide import get_cached_weather_tide

logger = logging.getLogger(__name__)
CORRIDOR_BUFFER_METERS = 80.0
CRITICAL_FLOOD_PENALTY_MINUTES = 999.0
# A deliberately broad HCMC service envelope. The Vietnam extract supports the full box.
HCMC_BOUNDS = (106.30, 10.35, 107.10, 11.20)  # west, south, east, north
_osrm_circuit_open_until = 0.0
OSRM_CACHE_TTL_SECONDS = 60


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates haversine distance in meters between two WGS84 points."""
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def _point_to_linestring_distance_meters(
    point_lat: float,
    point_lng: float,
    coords: List[List[float]],
) -> float:
    """Calculates min distance in meters from (point_lat, point_lng) to LineString [[lng, lat], ...]."""
    if not coords:
        return float("inf")

    def point_to_segment_dist(plat: float, plon: float, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        mid_lat = math.radians((lat1 + lat2 + plat) / 3.0)
        cos_mid = math.cos(mid_lat)
        kx = 111320.0 * cos_mid
        ky = 110540.0
        px, py = plon * kx, plat * ky
        x1, y1 = lon1 * kx, lat1 * ky
        x2, y2 = lon2 * kx, lat2 * ky
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return math.hypot(px - x1, py - y1)
        t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
        proj_x = x1 + t * dx
        proj_y = y1 + t * dy
        return math.hypot(px - proj_x, py - proj_y)

    min_dist = float("inf")
    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i][0], coords[i][1]
        lon2, lat2 = coords[i + 1][0], coords[i + 1][1]
        d = point_to_segment_dist(point_lat, point_lng, lat1, lon1, lat2, lon2)
        if d < min_dist:
            min_dist = d
    if len(coords) == 1:
        lon1, lat1 = coords[0][0], coords[0][1]
        d = point_to_segment_dist(point_lat, point_lng, lat1, lon1, lat1, lon1)
        min_dist = d
    return min_dist


class RoutingError(Exception):
    def __init__(self, code: str, status_code: int, message: str):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.message = message


def _validate_point(lat: float, lng: float) -> None:
    if not all(math.isfinite(v) for v in (lat, lng)) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise RoutingError("INVALID_COORDINATES", 422, "Coordinates must be finite WGS84 latitude/longitude.")
    west, south, east, north = HCMC_BOUNDS
    if not (west <= lng <= east and south <= lat <= north):
        raise RoutingError("OUTSIDE_SERVICE_AREA", 422, "Coordinates are outside the HCMC service area.")


def _valid_geometry(geometry: Any) -> bool:
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        return False
    coords = geometry.get("coordinates")
    return isinstance(coords, list) and len(coords) >= 2 and all(
        isinstance(pt, list) and len(pt) >= 2 and
        all(isinstance(v, (int, float)) and math.isfinite(v) for v in pt[:2]) and
        -180 <= pt[0] <= 180 and -90 <= pt[1] <= 90 for pt in coords
    )


def _valid_route(route: Any) -> bool:
    if not isinstance(route, dict) or not _valid_geometry(route.get("geometry")):
        return False
    try:
        return all(math.isfinite(float(route[k])) and float(route[k]) > 0 for k in ("distance", "duration"))
    except (KeyError, TypeError, ValueError):
        return False


def _osrm_cache_key(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> Optional[str]:
    """Cache only raw OSRM output and invalidate it when the local graph changes."""
    graph_version = settings.OSRM_GRAPH_VERSION
    if not graph_version:
        try:
            graph = os.stat("data/osrm/vietnam-latest.osrm.mldgr")
            graph_version = f"{graph.st_size}-{graph.st_mtime_ns}"
        except OSError:
            return None
    coordinates = f"{origin_lat:.6f},{origin_lng:.6f};{dest_lat:.6f},{dest_lng:.6f}"
    digest = hashlib.sha256(f"driving|{graph_version}|{coordinates}".encode()).hexdigest()
    return f"osrm:raw:route:{digest}"


async def _get_osrm_raw_routes(
    origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float,
    client: Optional[httpx.AsyncClient] = None,
) -> list[dict[str, Any]]:
    """Fetch up to three alternatives; OSRM may return fewer or only one."""
    global _osrm_circuit_open_until
    for lat, lng in ((origin_lat, origin_lng), (dest_lat, dest_lng)):
        _validate_point(lat, lng)
    if origin_lat == dest_lat and origin_lng == dest_lng:
        raise RoutingError("INVALID_COORDINATES", 422, "Origin and destination must differ.")
    if time.monotonic() < _osrm_circuit_open_until:
        raise RoutingError("ROUTING_PROVIDER_UNAVAILABLE", 503, "OSRM is temporarily unavailable.")

    url = (f"{settings.OSRM_BASE_URL.rstrip('/')}/route/v1/driving/"
           f"{origin_lng},{origin_lat};{dest_lng},{dest_lat}")
    params = {"alternatives": "3", "steps": "true", "geometries": "geojson", "overview": "full"}
    close_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=8.0)
    try:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        _osrm_circuit_open_until = time.monotonic() + 15.0
        logger.warning("OSRM request failed: %s", exc)
        raise RoutingError("ROUTING_PROVIDER_UNAVAILABLE", 503, "OSRM did not return a valid response.") from exc
    finally:
        if close_client:
            await client.aclose()

    if not isinstance(data, dict):
        raise RoutingError("ROUTING_PROVIDER_UNAVAILABLE", 503, "OSRM returned malformed JSON.")
    if data.get("code") in ("NoRoute", "NoSegment"):
        raise RoutingError("NO_ROUTE_FOUND", 404, "OSRM found no connected driving route.")
    if data.get("code") != "Ok":
        raise RoutingError("ROUTING_PROVIDER_UNAVAILABLE", 503, "OSRM returned an error.")
    routes = data.get("routes")
    if not isinstance(routes, list) or not routes:
        raise RoutingError("ROUTING_PROVIDER_UNAVAILABLE", 503, "OSRM returned no routes despite code=Ok.")
    if not all(_valid_route(route) for route in routes):
        raise RoutingError("ROUTING_PROVIDER_UNAVAILABLE", 503, "OSRM returned incomplete route geometry or metrics.")
    return routes


async def _count_cameras_in_corridor(
    coords: list[list[float]], db_session: Union[AsyncSession, Session]
) -> Optional[int]:
    """Count cameras with independently verified GPS near this line only."""
    if not _valid_geometry({"type": "LineString", "coordinates": coords}):
        return None
    wkt = "LINESTRING(" + ", ".join(f"{lng} {lat}" for lng, lat in (pt[:2] for pt in coords)) + ")"
    query = text("""SELECT count(DISTINCT cam_id) FROM traffic_cameras
        WHERE geom IS NOT NULL AND coordinate_source_url IS NOT NULL
          AND coordinate_verified_at IS NOT NULL
          AND ST_DWithin(geom::geography,
            ST_SetSRID(ST_GeomFromText(:line), 4326)::geography, :radius)""")
    try:
        result = await db_session.execute(query, {"line": wkt, "radius": CORRIDOR_BUFFER_METERS}) if isinstance(db_session, AsyncSession) else db_session.execute(query, {"line": wkt, "radius": CORRIDOR_BUFFER_METERS})
        return int(result.scalar_one())
    except Exception as exc:
        logger.warning("Camera corridor coverage unavailable: %s", exc)
        return None


async def _edge_candidates_for_step(
    coords: list[list[float]], db_session: Union[AsyncSession, Session]
) -> Optional[list[dict[str, int]]]:
    """Nearby OSM vertex-pair edges. A spatial candidate is not a verified OSRM edge ID."""
    if not _valid_geometry({"type": "LineString", "coordinates": coords}):
        return None
    wkt = "LINESTRING(" + ", ".join(f"{lng} {lat}" for lng, lat in (pt[:2] for pt in coords)) + ")"
    query = text("""
        SELECT e.osm_way_id, e.edge_index FROM road_edges e
        JOIN road_segments r ON r.osm_way_id = e.osm_way_id
        WHERE r.source_url = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf'
          AND ST_DWithin(e.geom::geography,
              ST_SetSRID(ST_GeomFromText(:line), 4326)::geography, 8)
        ORDER BY ST_Distance(e.geom::geography,
            ST_SetSRID(ST_GeomFromText(:line), 4326)::geography),
            e.osm_way_id, e.edge_index
        LIMIT 16
    """)
    try:
        result = await db_session.execute(query, {"line": wkt}) if isinstance(db_session, AsyncSession) else db_session.execute(query, {"line": wkt})
        return [{"osm_way_id": int(row[0]), "edge_index": int(row[1])} for row in result.fetchall()]
    except Exception as exc:
        logger.warning("OSM edge candidates unavailable: %s", exc)
        return None


async def _get_flood_prone_way_ids(
    way_ids: list[int], db_session: Union[AsyncSession, Session]
) -> Set[int]:
    """Returns the set of way_ids documented as flood prone in municipal records."""
    if not way_ids:
        return set()
    query = text("""
        SELECT osm_way_id FROM road_segments
        WHERE osm_way_id = ANY(:way_ids) AND is_flood_prone_history = TRUE
    """)
    try:
        if isinstance(db_session, AsyncSession):
            result = await db_session.execute(query, {"way_ids": way_ids})
        else:
            result = db_session.execute(query, {"way_ids": way_ids})
        return set(int(row[0]) for row in result.fetchall())
    except Exception as exc:
        logger.warning("Failed to query flood prone ways: %s", exc)
        return set()


async def _get_cameras_for_step(
    coords: list[list[float]],
    db_session: Union[AsyncSession, Session],
    redis_client: Optional[Redis] = None,
) -> list[CameraEvidence]:
    """Fetches cameras within corridor and resolves their latest live evidence state."""
    if not _valid_geometry({"type": "LineString", "coordinates": coords}):
        return []
    wkt = "LINESTRING(" + ", ".join(f"{lng} {lat}" for lng, lat in (pt[:2] for pt in coords)) + ")"
    query = text("""
        SELECT c.cam_id, c.code, c.name, c.district, ST_Y(c.geom) AS lat, ST_X(c.geom) AS lng,
               c.nearest_osm_way_id AS osm_way_id,
               c.coordinate_source_url, c.observed_osm_way_id,
               c.observed_edge_index, c.view_verification_source_url, c.line_of_sight_verified
        FROM traffic_cameras c
        WHERE c.geom IS NOT NULL AND c.coordinate_source_url IS NOT NULL
          AND c.coordinate_verified_at IS NOT NULL
          AND ST_DWithin(c.geom::geography,
              ST_SetSRID(ST_GeomFromText(:line), 4326)::geography, :radius)
    """)
    try:
        if isinstance(db_session, AsyncSession):
            res = await db_session.execute(query, {"line": wkt, "radius": CORRIDOR_BUFFER_METERS})
        else:
            res = db_session.execute(query, {"line": wkt, "radius": CORRIDOR_BUFFER_METERS})
        rows = res.fetchall()
        cameras: list[CameraEvidence] = []
        for r in rows:
            cam_data = None
            if redis_client is not None:
                try:
                    cached_raw = await redis_client.get(f"camera_evidence:{r.cam_id}")
                    if cached_raw:
                        cam_data = json.loads(cached_raw)
                except Exception:
                    pass

            if cam_data:
                try:
                    cameras.append(CameraEvidence.model_validate(cam_data))
                    continue
                except Exception:
                    pass

            match_status = "OBSERVED_SEGMENT_VERIFIED" if r.observed_osm_way_id is not None else "SPATIALLY_NEAR"
            has_local = os.path.exists(os.path.join("storage", "cams", f"{r.cam_id}.jpg"))
            cameras.append(CameraEvidence(
                cam_id=r.cam_id,
                code=r.code,
                name=r.name,
                district=r.district,
                lat=r.lat,
                lng=r.lng,
                osm_way_id=r.osm_way_id,
                coordinate_source_url=r.coordinate_source_url,
                spatial_match_status=match_status,
                observed_osm_way_id=r.observed_osm_way_id,
                observed_edge_index=r.observed_edge_index,
                view_verification_source_url=r.view_verification_source_url,
                line_of_sight_verified=bool(r.line_of_sight_verified),
                image_url=f"/api/v1/cameras/{r.cam_id}/image" if has_local else "",
                has_image=has_local,
                image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC if has_local else ImageAccessStatus.UNAVAILABLE,
                evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
                image_status="VALID_IMAGE_CACHED" if has_local else "NO_IMAGE",
                image_status_reason="VALID_IMAGE_CACHED" if has_local else "IMAGE_UNAVAILABLE",
                model_status="NOT_ANALYZED",
                vehicle_count=None,
                traffic_density_score=None,
                flood_ratio=None,
                risk_level=RiskLevel.UNKNOWN,
                source_status=DataSourceStatus.STALE,
                updated_at=datetime.now(timezone.utc),
            ))
        return cameras
    except Exception as exc:
        logger.warning("Failed to fetch corridor cameras: %s", exc)
        return []


async def _batched_spatial_context(
    routes: list[dict[str, Any]],
    db_session: Union[AsyncSession, Session],
    redis_client: Optional[Redis],
) -> tuple[dict[tuple[int, int], list[dict[str, int]]], dict[tuple[int, int], list[CameraEvidence]], bool, bool]:
    """Two PostGIS queries for all OSRM steps, then one Redis MGET for camera state.

    Nearby road edges remain candidates. No candidate is promoted to a verified
    OSRM Way, including the nearest edge on a bridge or parallel carriageway.
    """
    steps = []
    for route_idx, route in enumerate(routes):
        step_idx = 0
        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                if _valid_geometry(step.get("geometry")):
                    steps.append({"route_idx": route_idx, "step_idx": step_idx, "geometry": step["geometry"]})
                step_idx += 1
    if not steps:
        return {}, {}, True, True

    step_cte = """WITH step_lines AS (
        SELECT s.route_idx, s.step_idx,
               ST_SetSRID(ST_GeomFromGeoJSON(s.geometry::text), 4326)::geography AS geog
        FROM jsonb_to_recordset(CAST(:steps AS jsonb))
             AS s(route_idx integer, step_idx integer, geometry jsonb)
    )"""
    edge_sql = text(step_cte + """
        SELECT s.route_idx, s.step_idx, e.osm_way_id, e.edge_index
        FROM step_lines s JOIN LATERAL (
            SELECT e.osm_way_id, e.edge_index
            FROM road_edges e JOIN road_segments r ON r.osm_way_id = e.osm_way_id
            WHERE r.source_url = 'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf'
              AND ST_DWithin(e.geom::geography, s.geog, 8)
            ORDER BY ST_Distance(e.geom::geography, s.geog), e.osm_way_id, e.edge_index
            LIMIT 16
        ) e ON TRUE
    """)
    camera_sql = text(step_cte + """
        SELECT s.route_idx, s.step_idx, c.cam_id, c.code, c.name, c.district,
               ST_Y(c.geom) AS lat, ST_X(c.geom) AS lng,
               c.nearest_osm_way_id AS osm_way_id, c.coordinate_source_url,
               c.observed_osm_way_id, c.observed_edge_index,
               c.view_verification_source_url, c.line_of_sight_verified
        FROM step_lines s JOIN traffic_cameras c
          ON c.geom IS NOT NULL AND c.coordinate_source_url IS NOT NULL
         AND c.coordinate_verified_at IS NOT NULL
         AND ST_DWithin(c.geom::geography, s.geog, :radius)
    """)
    params = {"steps": json.dumps(steps, separators=(",", ":")), "radius": CORRIDOR_BUFFER_METERS}
    edges: dict[tuple[int, int], list[dict[str, int]]] = {}
    cameras: dict[tuple[int, int], list[CameraEvidence]] = {}
    edges_available = True
    cameras_available = True
    try:
        result = await db_session.execute(edge_sql, params) if isinstance(db_session, AsyncSession) else db_session.execute(edge_sql, params)
        for row in result.fetchall():
            edges.setdefault((row.route_idx, row.step_idx), []).append({"osm_way_id": int(row.osm_way_id), "edge_index": int(row.edge_index)})
    except Exception as exc:
        edges_available = False
        logger.warning("Batched road candidates unavailable: %s", exc)

    try:
        result = await db_session.execute(camera_sql, params) if isinstance(db_session, AsyncSession) else db_session.execute(camera_sql, params)
        rows = result.fetchall()
    except Exception as exc:
        cameras_available = False
        logger.warning("Batched camera coverage unavailable: %s", exc)
        rows = []

    unique_ids = list(dict.fromkeys(str(row.cam_id) for row in rows))
    cached: dict[str, CameraEvidence] = {}
    if unique_ids and redis_client is not None:
        try:
            values = await redis_client.mget([f"camera_evidence:{cam_id}" for cam_id in unique_ids])
            for cam_id, raw in zip(unique_ids, values):
                if raw:
                    try:
                        cached[cam_id] = CameraEvidence.model_validate_json(raw)
                    except Exception:
                        pass
        except Exception as exc:
            logger.warning("Batched camera cache read unavailable: %s", exc)

    fallback: dict[str, CameraEvidence] = {}
    for row in rows:
        cam_id = str(row.cam_id)
        evidence = cached.get(cam_id)
        if evidence is None:
            if cam_id not in fallback:
                has_local = os.path.exists(os.path.join("storage", "cams", f"{cam_id}.jpg"))
                fallback[cam_id] = CameraEvidence(
                    cam_id=cam_id, code=row.code, name=row.name, district=row.district,
                    lat=row.lat, lng=row.lng, osm_way_id=row.osm_way_id,
                    coordinate_source_url=row.coordinate_source_url,
                    spatial_match_status="OBSERVED_SEGMENT_VERIFIED" if row.observed_osm_way_id is not None and row.line_of_sight_verified else "SPATIALLY_NEAR",
                    observed_osm_way_id=row.observed_osm_way_id, observed_edge_index=row.observed_edge_index,
                    view_verification_source_url=row.view_verification_source_url,
                    line_of_sight_verified=bool(row.line_of_sight_verified),
                    image_url=f"/api/v1/cameras/{cam_id}/image" if has_local else "",
                    has_image=has_local,
                    image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC if has_local else ImageAccessStatus.UNAVAILABLE,
                    evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
                    image_status="VALID_IMAGE_CACHED" if has_local else "NO_IMAGE",
                    image_status_reason="VALID_IMAGE_CACHED" if has_local else "IMAGE_UNAVAILABLE",
                    model_status="NOT_ANALYZED", vehicle_count=None, traffic_density_score=None,
                    flood_ratio=None, risk_level=RiskLevel.UNKNOWN, source_status=DataSourceStatus.STALE,
                    updated_at=datetime.now(timezone.utc),
                )
            evidence = fallback[cam_id]
        cameras.setdefault((row.route_idx, row.step_idx), []).append(evidence)
    return edges, cameras, edges_available, cameras_available


async def find_safe_route(
    origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float,
    db_session: Union[AsyncSession, Session], redis_client: Optional[Redis] = None,
) -> list[SafeRouteResponse]:
    """Return actual OSRM candidates reranked by multi-criteria verified risk.

    - Distance and estimated travel time come strictly from raw OSRM metrics.
    - Ranking cost prioritizes routes with zero critical flooding without distorting the ETA.
    - If all candidates traverse an unavoidable critical flood point, a warning is issued.
    """
    raw_routes = await _get_osrm_raw_routes(origin_lat, origin_lng, dest_lat, dest_lng)
    
    # Ingest / fetch real hydrometeorological signal
    weather_tide: Optional[WeatherTideSignal] = None
    if redis_client is not None:
        try:
            weather_tide = await get_cached_weather_tide(redis_client)
        except Exception:
            weather_tide = None
    if weather_tide is None:
        try:
            weather_tide = await get_combined_weather_tide(
                lat=origin_lat, lng=origin_lng, redis_client=redis_client
            )
        except Exception as exc:
            logger.warning("Failed to obtain live weather/tide in routing: %s", exc)
            weather_tide = None

    responses: list[SafeRouteResponse] = []
    for route in raw_routes:
        coords = route["geometry"]["coordinates"]
        camera_count = await _count_cameras_in_corridor(coords, db_session)
        segments: list[RouteSegmentRisk] = []
        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                geometry = step.get("geometry")
                if not _valid_geometry(geometry):
                    continue
                distance = step.get("distance")
                if not isinstance(distance, (int, float)) or not math.isfinite(distance) or distance < 0:
                    continue
                maneuver = step.get("maneuver") if isinstance(step.get("maneuver"), dict) else {}
                raw_location = maneuver.get("location")
                maneuver_location = (
                    [float(raw_location[0]), float(raw_location[1])]
                    if isinstance(raw_location, list) and len(raw_location) >= 2
                    and all(isinstance(v, (int, float)) and math.isfinite(v) for v in raw_location[:2])
                    else None
                )
                maneuver_fields = {
                    "maneuver_type": maneuver.get("type") if isinstance(maneuver.get("type"), str) else None,
                    "maneuver_modifier": maneuver.get("modifier") if isinstance(maneuver.get("modifier"), str) else None,
                    "maneuver_location": maneuver_location,
                    "maneuver_exit": maneuver.get("exit") if isinstance(maneuver.get("exit"), int) and maneuver.get("exit") > 0 else None,
                }

                segment_camera_count = await _count_cameras_in_corridor(geometry["coordinates"], db_session)
                edge_candidates = await _edge_candidates_for_step(geometry["coordinates"], db_session)
                road_candidates = list(dict.fromkeys(edge["osm_way_id"] for edge in edge_candidates or []))
                
                # Check for documented municipal flood points
                flood_prone_way_ids = await _get_flood_prone_way_ids(road_candidates, db_session)
                is_flood_prone = bool(flood_prone_way_ids)

                # Fetch any verified or corridor cameras
                step_cameras = await _get_cameras_for_step(geometry["coordinates"], db_session, redis_client)

                segment_coverage = "SPATIALLY_NEAR_UNVERIFIED_VIEW" if segment_camera_count else "NO_VERIFIED_CAMERA_GPS"
                if segment_camera_count is None:
                    segment_coverage = "CORRIDOR_DATA_UNAVAILABLE"

                if road_candidates and distance > 0:
                    try:
                        step_risk = calculate_segment_risk(
                            segment={
                                "osm_way_id": road_candidates[0],
                                "edge_index": edge_candidates[0]["edge_index"] if edge_candidates else None,
                                "street_name": step.get("name") or None,
                                "length_meters": distance,
                                "source_url": "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf",
                                "is_flood_prone_history": True if is_flood_prone else None,
                            },
                            camera_evidences=step_cameras,
                            weather_tide=weather_tide,
                        )
                        step_risk.geojson_path = geometry
                        for field, value in maneuver_fields.items():
                            setattr(step_risk, field, value)
                        step_risk.candidate_osm_way_ids = road_candidates
                        step_risk.candidate_road_edges = edge_candidates or []
                        step_risk.road_match_status = "CANDIDATE_ONLY"
                        if not step_risk.evidence_cameras and step_cameras:
                            step_risk.evidence_coverage = segment_coverage
                        segments.append(step_risk)
                    except Exception as exc:
                        logger.warning("Error calculating step risk: %s", exc)
                        segments.append(RouteSegmentRisk(
                            osm_way_id=None, candidate_osm_way_ids=road_candidates or [],
                            candidate_road_edges=edge_candidates or [],
                            road_match_status="CANDIDATE_ONLY" if edge_candidates else "NO_ROAD_EDGE_MATCH",
                            street_name=step.get("name") or None,
                            geojson_path=geometry,
                            length_meters=distance, risk_score=None, risk_level=RiskLevel.UNKNOWN,
                            **maneuver_fields,
                            evidence_coverage=segment_coverage, evidence_cameras=[],
                        ))
                else:
                    segments.append(RouteSegmentRisk(
                        osm_way_id=None, candidate_osm_way_ids=road_candidates or [],
                        candidate_road_edges=edge_candidates or [],
                        road_match_status="CANDIDATE_ONLY" if edge_candidates else "NO_ROAD_EDGE_MATCH" if edge_candidates is not None else "ROAD_GRAPH_UNAVAILABLE",
                        street_name=step.get("name") or None,
                        geojson_path=geometry,
                        length_meters=distance, risk_score=None, risk_level=RiskLevel.UNKNOWN,
                        **maneuver_fields,
                        evidence_coverage=segment_coverage, evidence_cameras=[],
                    ))

        critical_count = sum(1 for s in segments if s.risk_level == RiskLevel.CRITICAL)
        moderate_count = sum(1 for s in segments if s.risk_level == RiskLevel.MODERATE)
        unknown_count = sum(1 for s in segments if s.risk_level == RiskLevel.UNKNOWN)

        duration_seconds = float(route["duration"])
        estimated_time_mins = round(duration_seconds / 60.0, 2)
        ranking_cost = round(duration_seconds + (critical_count * 3600.0) + (moderate_count * 600.0), 2)

        if critical_count > 0:
            overall_risk = RiskLevel.CRITICAL
            route_status = "ROUTE_CRITICAL_RISK_WARNING"
            ai_explanation = (
                f"CẢNH BÁO: Tuyến đường này có {critical_count} đoạn nguy cơ ngập nghiêm trọng hoặc kẹt xe cao "
                f"(dựa trên dữ liệu quan trắc/lịch sử ngập kết hợp thời tiết). Cần hết sức cẩn trọng khi di chuyển."
            )
        elif moderate_count > 0:
            overall_risk = RiskLevel.MODERATE
            route_status = "ROUTE_MODERATE_RISK_CAUTION"
            ai_explanation = (
                f"LƯU Ý: Tuyến đường có {moderate_count} đoạn nguy cơ ngập vừa hoặc mật độ giao thông tăng cao. "
                f"Thời gian dự kiến: {estimated_time_mins} phút. Đã ưu tiên tránh các đoạn ngập nặng."
            )
        elif unknown_count > 0:
            overall_risk = RiskLevel.UNKNOWN
            route_status = "ROUTE_FOUND_RISK_UNKNOWN"
            ai_explanation = (
                f"Đã tìm thấy tuyến đường ({estimated_time_mins} phút, {round(route['distance'] / 1000, 2)} km). "
                f"Một số đoạn đường chưa có camera quan sát trực tiếp để xác minh rủi ro."
            )
        else:
            overall_risk = RiskLevel.SAFE
            route_status = "ROUTE_SAFE_VERIFIED"
            ai_explanation = "Các đoạn trên tuyến hiện có tín hiệu rủi ro thấp theo dữ liệu sẵn có. Điều kiện thực tế có thể thay đổi."

        coverage = "SPATIALLY_NEAR_UNVERIFIED_VIEW" if camera_count else "NO_VERIFIED_CAMERA_GPS"
        if camera_count is None:
            coverage = "CORRIDOR_DATA_UNAVAILABLE"

        responses.append(SafeRouteResponse(
            route_id=str(uuid.uuid4()),
            total_distance_km=round(route["distance"] / 1000, 3),
            estimated_time_mins=estimated_time_mins,
            ranking_cost=ranking_cost,
            overall_risk=overall_risk,
            route_status=route_status,
            evidence_coverage=coverage,
            critical_segments_count=critical_count,
            moderate_segments_count=moderate_count,
            unknown_segments_count=unknown_count,
            geojson_path=route["geometry"],
            segments=segments,
            ai_explanation=ai_explanation,
        ))

    # Rerank candidate routes by ranking_cost ascending
    responses.sort(key=lambda r: (r.ranking_cost if r.ranking_cost is not None else float("inf"), r.estimated_time_mins))

    # If all candidates have critical risk, update top explanation with transparent warning
    if responses and all(r.critical_segments_count > 0 for r in responses):
        responses[0].ai_explanation = (
            "CẢNH BÁO: Mọi lộ trình khả dụng đều đi qua khu vực có nguy cơ ngập lụt nghiêm trọng "
            "(dựa trên lịch sử ngập đô thị và điều kiện thời tiết/thủy triều hiện tại). Tuyến đường hiển thị là "
            "phương án ít rủi ro nhất trong các lựa chọn, nhưng khuyến cáo không nên di chuyển qua vùng ngập sâu."
        )

    return responses
