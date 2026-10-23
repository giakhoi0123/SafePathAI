"""
SafePathAI Core FastAPI Application and Real-Time WebSocket Server.
Exposes RESTful endpoints for routing, camera evidence, simulation triggers,
and WebSocket streams for real-time traffic and flood alerts.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import logging
import os
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional, Set
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from geoalchemy2.elements import WKTElement
import httpx
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.db.models import RoadSegment, TrafficCamera
from backend.app.db.session import (
    AsyncSessionLocal,
    _is_testing_environment,
    close_db,
    get_db,
    get_redis_client,
    init_db,
)
from backend.app.schemas.contracts import (
    CameraEvidence,
    CameraImageMetadata,
    Coordinates,
    DataSourceStatus,
    EvidenceEligibility,
    ImageAccessStatus,
    PlaceResult,
    PlaceSearchResponse,
    RiskLevel,
    RouteSearchRequest,
    SafeRouteResponse,
    WeatherTideSignal,
    WebSocketAlertMessage,
)
from backend.app.services.geocoding import reverse_geocode, search_places
from backend.app.services.image_validator import validate_camera_image_bytes
from backend.app.services.mcp_explanation import generate_route_explanation
from backend.app.services.routing import find_safe_route, RoutingError
from backend.app.services.scraper import (
    evict_stale_disk_images,
    is_valid_cam_id,
    portal_circuit_breaker,
    scrape_active_cameras,
)
from backend.app.services.vision import process_all_cameras_vision, verified_model_manifest_entry, DEFAULT_YOLO_PATH, DEFAULT_FLOOD_UNET_PATH
from backend.app.services.weather_tide import (
    get_cached_weather_tide,
    get_combined_weather_tide,
    sync_weather_tide_to_redis,
)

logger = logging.getLogger("safepath.api")
logging.basicConfig(level=logging.INFO)


# ==============================================================================
# Real-Time WebSocket Alert Broadcaster
# ==============================================================================
class AlertBroadcaster:
    """Manages active WebSocket client connections and broadcasts alerts."""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
        logger.info("WebSocket client connected. Active: %d", len(self.active_connections))

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self.active_connections.discard(websocket)
        logger.info("WebSocket client disconnected. Active: %d", len(self.active_connections))

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcasts a JSON dictionary payload to all connected clients."""
        async with self._lock:
            dead_connections = set()
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception as exc:
                    logger.warning("Failed to send WebSocket message: %s", exc)
                    dead_connections.add(connection)
            self.active_connections.difference_update(dead_connections)


broadcaster = AlertBroadcaster()


# ==============================================================================
# Periodic Background Worker Loop
# ==============================================================================
async def background_camera_worker_loop(stop_event: asyncio.Event) -> None:
    """
    Autonomous background worker that periodically:
    1. If CAMERA_INGESTION_PERMITTED: scrapes active cameras and runs Computer Vision.
       Else: transparently logs PERMISSION_UNVERIFIED and skips scraping.
    2. Syncs real-time weather and tide signals to Redis.
    """
    logger.info("Starting background camera worker daemon...")
    while not stop_event.is_set():
        try:
            # 0. Evict stale snapshots past retention threshold
            try:
                evicted = evict_stale_disk_images("storage/cams", max_hours=settings.CAMERA_DISK_EVICTION_MAX_HOURS)
                if evicted > 0:
                    logger.info("Evicted %d stale camera snapshots from disk cache.", evicted)
            except Exception as e:
                logger.debug("Disk eviction skipped: %s", e)

            # 1. Camera Ingestion & Vision Processing (prioritized batching)
            can_scrape = (settings.CAMERA_INGESTION_PERMITTED or settings.CAMERA_ALLOW_VIEW_ONLY)
            if can_scrape and portal_circuit_breaker.can_request():
                try:
                    async with AsyncSessionLocal() as session:
                        result = await session.execute(
                            text("""
                                SELECT cam_id, code, name, district, ST_Y(geom) as lat, ST_X(geom) as lng 
                                FROM traffic_cameras 
                                WHERE geom IS NOT NULL 
                                ORDER BY 
                                    CASE WHEN snapshot_cam_status = 'UP' THEN 0 ELSE 1 END,
                                    cam_id ASC
                                LIMIT 8
                            """)
                        )
                        cams = [
                            {"cam_id": r.cam_id, "code": r.code, "name": r.name, "district": r.district, "lat": r.lat, "lng": r.lng}
                            for r in result.fetchall()
                        ]
                    if cams:
                        scraped = await scrape_active_cameras(cams)
                        valid_scraped = [s.to_dict() for s in scraped if s.is_valid_image]
                        if valid_scraped:
                            await process_all_cameras_vision(valid_scraped)
                except Exception as exc:
                    logger.warning("Camera ingestion/vision batch error: %s", exc)
            elif not can_scrape:
                logger.debug("Camera ingestion disabled: CAMERA_INGESTION_PERMITTED=false and CAMERA_ALLOW_VIEW_ONLY=false.")
            else:
                logger.debug("Camera ingestion temporarily paused: portal circuit breaker is OPEN.")

            # 2. Sync weather and tide signal
            redis = get_redis_client()
            try:
                await sync_weather_tide_to_redis(redis_client=redis)
            finally:
                await redis.aclose()

            # Wait for scrape interval or cancellation
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=float(settings.CAMERA_SCRAPE_INTERVAL_SEC))
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Error in background worker iteration: %s", exc)
            await asyncio.sleep(5.0)

    logger.info("Background camera worker daemon stopped.")


# ==============================================================================
# Application Lifespan
# ==============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manages application startup and graceful shutdown."""
    logger.info("Initializing SafePathAI Backend Infrastructure...")
    await init_db()
    app.state.osrm_client = httpx.AsyncClient(timeout=8.0, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20))

    stop_event = asyncio.Event()
    worker_task = asyncio.create_task(background_camera_worker_loop(stop_event))

    yield

    # Teardown
    stop_event.set()
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass

    await app.state.osrm_client.aclose()
    await close_db()
    logger.info("SafePathAI Backend Shutdown complete.")


# ==============================================================================
# FastAPI App Initialization & CORS
# ==============================================================================
app = FastAPI(
    title="SafePathAI Navigation Engine",
    description=(
        "Dynamic flood-aware traffic routing and computer vision surveillance API "
        "for Ho Chi Minh City."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


# ==============================================================================
# REST Endpoints
# ==============================================================================
@app.get("/api/v1/models/status", tags=["Surveillance"])
async def model_status() -> Dict[str, Any]:
    """Expose weight provenance and deployment validation without claiming local accuracy."""
    vehicle = verified_model_manifest_entry("vehicle_detector", DEFAULT_YOLO_PATH)
    flood = verified_model_manifest_entry("flood_segmenter", DEFAULT_FLOOD_UNET_PATH)
    return {
        "vehicle_detector": {
            "status": "EXPERIMENTAL" if vehicle else "MODEL_UNAVAILABLE",
            "model_name": vehicle.get("model_name") if vehicle else None,
            "version": vehicle.get("version") if vehicle else None,
            "sha256": vehicle.get("sha256") if vehicle else None,
            "source_url": vehicle.get("source_url") if vehicle else None,
            "provenance_status": vehicle.get("provenance_status") if vehicle else None,
            "deployment_validation": vehicle.get("deployment_validation") if vehicle else None,
        },
        "flood_segmenter": {
            "status": "VALIDATED" if flood else "MODEL_UNAVAILABLE",
            "model_name": flood.get("model_name") if flood else None,
            "version": flood.get("version") if flood else None,
            "sha256": flood.get("sha256") if flood else None,
            "source_url": flood.get("source_url") if flood else None,
        },
    }


@app.get(
    "/api/v1/places/search",
    response_model=PlaceSearchResponse,
    summary="Search places, addresses, and POIs in TP.HCM",
    tags=["Geocoding"],
)
async def search_hcm_places(
    q: str = Query(..., min_length=1, description="Address, street name, POI, or coordinates"),
    limit: int = Query(6, ge=1, le=15, description="Max results to return"),
    session: AsyncSession = Depends(get_db),
) -> PlaceSearchResponse:
    """
    Searches for real locations in TP. Hồ Chí Minh using Photon (Komoot OSM)
    with local PostGIS road segments fallback and coordinate parsing.
    Zero-Mock: Returns genuine geocoded results or empty list; never fabricates fake locations.
    """
    redis = get_redis_client()
    try:
        return await search_places(q=q, limit=limit, session=session, redis=redis)
    finally:
        if redis is not None:
            await redis.aclose()


@app.get(
    "/api/v1/places/reverse",
    response_model=PlaceResult,
    summary="Reverse geocode coordinates to an address or nearest road",
    tags=["Geocoding"],
)
async def reverse_hcm_place(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude"),
    lng: float = Query(..., ge=-180.0, le=180.0, description="Longitude"),
    session: AsyncSession = Depends(get_db),
) -> PlaceResult:
    """
    Reverse geocodes a WGS84 point into an address or street name.
    """
    redis = get_redis_client()
    try:
        return await reverse_geocode(lat=lat, lng=lng, session=session, redis=redis)
    finally:
        if redis is not None:
            await redis.aclose()


@app.get(
    "/api/v1/health",
    summary="System Health & Infrastructure Status",
    tags=["System"],
)
async def get_health(
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Returns live connectivity status for PostgreSQL/PostGIS, Redis, OSRM,
    and reports the true timestamp/age of the latest camera update (null if unobserved).
    Zero-Mock: Never fabricates timestamps or simulation fallbacks.
    """
    # 1. Check PostgreSQL
    db_status = "unhealthy"
    try:
        await session.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as exc:
        db_status = f"unhealthy ({exc})"

    # 2. Check Redis & retrieve true camera update age
    redis = get_redis_client()
    redis_status = "unhealthy"
    latest_update: Optional[str] = None
    camera_data_age_seconds: Optional[float] = None
    try:
        if await redis.ping():
            redis_status = "healthy"
            raw_ts = await redis.get("camera:latest_verified_update")
            if raw_ts:
                latest_update = raw_ts.decode() if isinstance(raw_ts, bytes) else str(raw_ts)
                try:
                    dt = datetime.fromisoformat(latest_update)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    camera_data_age_seconds = max(0.0, (datetime.now(timezone.utc) - dt).total_seconds())
                except Exception:
                    pass
    except Exception as exc:
        redis_status = f"unhealthy ({exc})"
    finally:
        if redis is not None:
            await redis.aclose()

    # 3. Check OSRM
    osrm_status = "available"
    try:
        async with httpx.AsyncClient(timeout=1.0) as client:
            resp = await client.get(f"{settings.OSRM_BASE_URL}/route/v1/driving/106.7,10.7;106.8,10.8")
            if resp.status_code != 200 or resp.json().get("code") != "Ok":
                osrm_status = "unavailable"
    except Exception:
        osrm_status = "unavailable"

    return {
        "status": "healthy" if db_status == "healthy" and redis_status == "healthy" and osrm_status == "available" else "degraded",
        "database": db_status,
        "redis": redis_status,
        "osrm": osrm_status,
        "last_camera_update": latest_update,
        "camera_data_age_seconds": camera_data_age_seconds,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get(
    "/api/v1/weather-tide",
    response_model=WeatherTideSignal,
    summary="Get current hydrometeorological signal (rain precipitation and tide level)",
    tags=["Environmental"],
)
async def get_weather_tide() -> WeatherTideSignal:
    """
    Returns current verified weather precipitation and tidal water level for HCMC.
    Zero-Mock: Missing metrics return None / UNAVAILABLE, never defaults to 0.0 mm/h or fake tide.
    """
    redis = get_redis_client()
    try:
        cached = await get_cached_weather_tide(redis)
        if cached:
            return cached
        signal = await get_combined_weather_tide(redis_client=redis)
        return signal
    finally:
        if redis is not None:
            await redis.aclose()


@app.get(
    "/api/v1/cameras",
    response_model=List[CameraEvidence],
    summary="List all traffic cameras and live evidence",
    tags=["Surveillance"],
)
async def list_cameras(
    district: Optional[str] = Query(None, description="Optional filter by district name"),
    bbox: Optional[str] = Query(None, description="west,south,east,north WGS84 map bounds"),
    limit: int = Query(1000, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_db),
) -> List[CameraEvidence]:
    """
    Returns registered cameras with verified GIS coordinates and their latest evidence state.
    Zero-Mock: Cameras without verified real-time observations remain at RiskLevel.UNKNOWN.
    """
    query_str = """
        SELECT 
            c.cam_id,
            c.code,
            c.name,
            c.district,
            ST_Y(c.geom) AS lat,
            ST_X(c.geom) AS lng,
            c.nearest_osm_way_id AS osm_way_id,
            c.coordinate_source_url,
            c.observed_osm_way_id,
            c.observed_edge_index,
            c.view_verification_source_url,
            c.line_of_sight_verified,
            c.snapshot_cam_status
        FROM traffic_cameras c
        WHERE c.geom IS NOT NULL
    """
    params: Dict[str, Any] = {}
    if district:
        query_str += " AND c.district = :district"
        params["district"] = district
    if bbox:
        try:
            west, south, east, north = (float(value) for value in bbox.split(","))
            if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError("invalid bounds")
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="bbox must be west,south,east,north in WGS84")
        query_str += " AND c.geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)"
        params.update({"west": west, "south": south, "east": east, "north": north})
    query_str += " ORDER BY c.cam_id ASC LIMIT :limit OFFSET :offset"
    params.update({"limit": limit, "offset": offset})

    stmt = text(query_str)
    result = await session.execute(stmt, params)
    rows = result.fetchall()

    redis = get_redis_client()
    evidence_list: List[CameraEvidence] = []
    now = datetime.now(timezone.utc)

    try:
        try:
            cached_values = await redis.mget([f"camera_evidence:{row.cam_id}" for row in rows]) if rows else []
        except Exception:
            cached_values = [None] * len(rows)
        for row, cached_raw in zip(rows, cached_values):
            cam_id = row.cam_id
            redis_data = None
            try:
                if cached_raw:
                    redis_data = json.loads(cached_raw)
            except Exception:
                pass

            local_image_path = os.path.join("storage", "cams", f"{cam_id}.jpg")
            has_local_file = os.path.exists(local_image_path)

            if redis_data:
                evidence = CameraEvidence(**redis_data)
                # Requirement 7: Unverified view direction/LOS never decides risk; remains UNKNOWN
                if not row.line_of_sight_verified or not settings.CAMERA_ROUTING_EVIDENCE_PERMITTED:
                    evidence.risk_level = RiskLevel.UNKNOWN
                    evidence.evidence_eligibility = EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING
            else:
                spatial_status = (
                    "OBSERVED_SEGMENT_VERIFIED"
                    if row.line_of_sight_verified and row.observed_osm_way_id is not None
                    else "SPATIALLY_NEAR" if row.osm_way_id is not None
                    else "UNVERIFIED"
                )
                is_fresh = False
                if has_local_file:
                    file_age = now.timestamp() - os.path.getmtime(local_image_path)
                    is_fresh = (file_age <= settings.CAMERA_IMAGE_TTL_SECONDS)

                evidence = CameraEvidence(
                    cam_id=cam_id,
                    code=row.code,
                    name=row.name,
                    district=row.district,
                    lat=row.lat,
                    lng=row.lng,
                    osm_way_id=row.osm_way_id,
                    coordinate_source_url=row.coordinate_source_url,
                    spatial_match_status=spatial_status,
                    observed_osm_way_id=row.observed_osm_way_id,
                    observed_edge_index=row.observed_edge_index,
                    view_verification_source_url=row.view_verification_source_url,
                    line_of_sight_verified=bool(row.line_of_sight_verified),
                    image_url=f"/api/v1/cameras/{cam_id}/image" if has_local_file else "",
                    has_image=has_local_file,
                    image_access_status=ImageAccessStatus.VIEWABLE_PUBLIC if has_local_file else ImageAccessStatus.UNAVAILABLE,
                    evidence_eligibility=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
                    image_status="VALID_IMAGE_CACHED" if has_local_file else "NO_IMAGE",
                    image_status_reason="VALID_IMAGE_CACHED" if has_local_file else "IMAGE_UNAVAILABLE",
                    model_status="NOT_ANALYZED",
                    vehicle_count=None,
                    traffic_density_score=None,
                    flood_ratio=None,
                    risk_level=RiskLevel.UNKNOWN,
                    source_status=DataSourceStatus.LIVE if is_fresh else DataSourceStatus.STALE,
                    updated_at=now,
                )
            evidence_list.append(evidence)
    finally:
        if redis is not None:
            await redis.aclose()

    return evidence_list


@app.get(
    "/api/v1/cameras/{cam_id}/image",
    summary="Get camera snapshot or AI analyzed evidence overlay",
    tags=["Surveillance"],
)
async def get_camera_image(
    cam_id: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    """
    Returns verified image snapshot for the given camera ID.
    Zero-Mock: Returns HTTP 404/503 if no valid verified image exists.
    Never returns sample or simulated mock images.
    Enforces path traversal protection and returns ETag / Cache-Control headers.
    """
    if not is_valid_cam_id(cam_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_CAMERA_ID", "message": "Malformed or unsafe camera identifier."},
        )

    # 1. Verify existence of camera in database
    cam_check = await session.execute(
        text("SELECT cam_id FROM traffic_cameras WHERE cam_id = :cam_id"),
        {"cam_id": cam_id},
    )
    if not cam_check.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CAMERA_NOT_FOUND", "message": f"Camera '{cam_id}' is not registered."},
        )

    # 2. Check local validated storage
    local_path = os.path.join("storage", "cams", f"{cam_id}.jpg")
    if not os.path.exists(local_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "CAMERA_IMAGE_UNAVAILABLE",
                "message": f"No verified snapshot currently available for camera '{cam_id}'.",
            },
        )

    # 3. Validate file on disk before serving
    try:
        with open(local_path, "rb") as f:
            content = f.read()
        val = validate_camera_image_bytes(content)
        if not val.is_valid:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "CAMERA_IMAGE_CORRUPTED",
                    "message": f"Cached frame failed validation: {val.error_message}",
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "IMAGE_READ_ERROR", "message": str(exc)},
        )

    etag = f'"{val.md5_hash}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED)

    now = datetime.now(timezone.utc)
    file_age = now.timestamp() - os.path.getmtime(local_path)
    is_fresh = file_age <= settings.CAMERA_IMAGE_TTL_SECONDS

    media_type = "image/jpeg" if val.format == "JPEG" else f"image/{val.format.lower() if val.format else 'jpeg'}"
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=60" if is_fresh else "no-cache",
        "X-Image-Access-Status": ImageAccessStatus.VIEWABLE_PUBLIC.value,
        "X-Evidence-Eligibility": EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING.value,
        "X-Captured-At": val.captured_at.isoformat() if val.captured_at else "UNKNOWN",
        "X-Retrieved-At": val.retrieved_at.isoformat(),
    }
    return FileResponse(local_path, media_type=media_type, headers=headers)


@app.get(
    "/api/v1/cameras/{cam_id}/metadata",
    response_model=CameraImageMetadata,
    summary="Get camera snapshot technical metadata, provenance, and eligibility",
    tags=["Surveillance"],
)
async def get_camera_metadata(
    cam_id: str,
    session: AsyncSession = Depends(get_db),
) -> CameraImageMetadata:
    """
    Returns technical metadata for camera snapshot: ETag, access status, reason codes,
    provenance, and eligibility for routing without transferring large image bytes.
    """
    if not is_valid_cam_id(cam_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_CAMERA_ID", "message": "Malformed or unsafe camera identifier."},
        )

    stmt = text("""
        SELECT c.cam_id, c.code, c.name, c.district, ST_Y(c.geom) AS lat, ST_X(c.geom) AS lng,
               c.coordinate_source_url, c.source_uri, c.observed_osm_way_id, c.line_of_sight_verified
        FROM traffic_cameras c
        WHERE c.cam_id = :cam_id
    """)
    res = await session.execute(stmt, {"cam_id": cam_id})
    row = res.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CAMERA_NOT_FOUND", "message": f"Camera '{cam_id}' is not registered."},
        )

    local_path = os.path.join("storage", "cams", f"{cam_id}.jpg")
    has_local = os.path.exists(local_path)
    etag = None
    content_length = None
    mime_type = None
    captured_at = None
    retrieved_at = None
    image_status_reason = "IMAGE_UNAVAILABLE"
    access_status = ImageAccessStatus.UNAVAILABLE
    eligibility = EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING

    redis = get_redis_client()
    redis_data = None
    try:
        raw = await redis.get(f"camera_evidence:{cam_id}")
        if raw:
            redis_data = json.loads(raw)
    except Exception:
        pass
    finally:
        if redis is not None:
            await redis.aclose()

    if has_local:
        try:
            with open(local_path, "rb") as f:
                content = f.read()
            val = validate_camera_image_bytes(content)
            if val.is_valid:
                has_local = True
                etag = f'"{val.md5_hash}"'
                content_length = len(content)
                mime_type = "image/jpeg" if val.format == "JPEG" else f"image/{val.format.lower() if val.format else 'jpeg'}"
                captured_at = val.captured_at
                retrieved_at = val.retrieved_at
                image_status_reason = "VALID_IMAGE_CACHED"
                access_status = ImageAccessStatus.VIEWABLE_PUBLIC
            else:
                has_local = False
                image_status_reason = val.status.value
        except Exception:
            has_local = False
            image_status_reason = "IMAGE_READ_ERROR"

    if not has_local and not portal_circuit_breaker.can_request():
        access_status = ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
        image_status_reason = "EXTERNAL_ACCESS_RESTRICTED"

    source_url = row.source_uri or (
        f"{settings.HCMC_CAMERA_BASE_URL}?id={cam_id}&bg=black&w=300&h=230"
    )

    return CameraImageMetadata(
        cam_id=row.cam_id,
        code=row.code,
        name=row.name,
        district=row.district,
        lat=row.lat,
        lng=row.lng,
        has_image=has_local,
        image_url=f"/api/v1/cameras/{cam_id}/image" if has_local else None,
        source_url=source_url,
        image_access_status=access_status,
        evidence_eligibility=eligibility,
        image_status_reason=image_status_reason,
        captured_at=captured_at,
        retrieved_at=retrieved_at,
        analyzed_at=datetime.fromisoformat(redis_data["analyzed_at"]) if (redis_data and redis_data.get("analyzed_at")) else None,
        source_updated_at=None,
        model_status=redis_data.get("model_status", "NOT_ANALYZED") if redis_data else "NOT_ANALYZED",
        vehicle_count=redis_data.get("vehicle_count") if redis_data else None,
        traffic_density_score=redis_data.get("traffic_density_score") if redis_data else None,
        flood_ratio=redis_data.get("flood_ratio") if redis_data else None,
        etag=etag,
        content_length=content_length,
        mime_type=mime_type,
    )


@app.post(
    "/api/v1/routes/search",
    response_model=SafeRouteResponse,
    summary="Return verified OSRM driving candidates and evidence coverage",
    tags=["Navigation"],
)
async def search_safe_route(
    request: RouteSearchRequest,
    http_request: Request,
    session: AsyncSession = Depends(get_db),
) -> SafeRouteResponse:
    """
    Query OSRM driving candidates. Distance and ETA come solely from OSRM.
    Risk remains UNKNOWN until verified corridor observations are available.
    """
    redis = get_redis_client()
    try:
        # Execute mathematical routing
        try:
            routes = await find_safe_route(
            origin_lat=request.origin.lat,
            origin_lng=request.origin.lng,
            dest_lat=request.destination.lat,
            dest_lng=request.destination.lng,
            db_session=session,
            redis_client=redis,
            osrm_client=getattr(http_request.app.state, "osrm_client", None),
            request_id=http_request.state.request_id,
            )
        except RoutingError as exc:
            raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc

        if not routes:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No accessible route could be found between the specified coordinates.",
            )

        # Top recommended route and alternative routes
        recommended_route = routes[0]
        alternative_routes = routes[1:]

        recommended_route.alternative_routes = alternative_routes

        return recommended_route
    finally:
        if redis is not None:
            await redis.aclose()


# WebSocket Endpoint for Real-Time Alerts
# ==============================================================================
@app.websocket("/ws/alerts")
async def websocket_alerts_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for frontends:
    Pushes instantaneous notifications when road segments or cameras transition to CRITICAL.
    Every alert contains event_id, observed_at, severity, source, and expiry.
    """
    await broadcaster.connect(websocket)
    try:
        # Send initial welcome and state message with full schema contract
        welcome_msg = WebSocketAlertMessage(
            event_id=str(uuid.uuid4()),
            type="CONNECTION_ESTABLISHED",
            severity="INFO",
            source="safepath_engine",
            message="Connected to SafePathAI live traffic & flood alert stream.",
            observed_at=datetime.now(timezone.utc),
        )
        await websocket.send_text(welcome_msg.model_dump_json())

        # Keep connection alive and handle client pings
        while True:
            data = await websocket.receive_text()
            # Echo heartbeat ping/pong
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await broadcaster.disconnect(websocket)
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
        await broadcaster.disconnect(websocket)
