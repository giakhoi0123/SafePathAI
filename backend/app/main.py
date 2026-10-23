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
    Coordinates,
    DataSourceStatus,
    RiskLevel,
    RouteSearchRequest,
    SafeRouteResponse,
    WeatherTideSignal,
    WebSocketAlertMessage,
)
from backend.app.services.image_validator import validate_camera_image_bytes
from backend.app.services.mcp_explanation import generate_route_explanation
from backend.app.services.routing import find_safe_route, RoutingError
from backend.app.services.scraper import scrape_active_cameras
from backend.app.services.vision import process_all_cameras_vision
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
            # 1. Camera Ingestion & Vision Processing (if permitted)
            if settings.CAMERA_INGESTION_PERMITTED:
                try:
                    async with AsyncSessionLocal() as session:
                        result = await session.execute(
                            text("SELECT cam_id, code, name, district, ST_Y(geom) as lat, ST_X(geom) as lng FROM traffic_cameras WHERE geom IS NOT NULL LIMIT 20")
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
            else:
                logger.debug("Camera ingestion disabled: CAMERA_INGESTION_PERMITTED=false (PERMISSION_UNVERIFIED).")

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


# ==============================================================================
# REST Endpoints
# ==============================================================================
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
        await redis.aclose()


@app.get(
    "/api/v1/cameras",
    response_model=List[CameraEvidence],
    summary="List all traffic cameras and live evidence",
    tags=["Surveillance"],
)
async def list_cameras(
    district: Optional[str] = Query(None, description="Optional filter by district name"),
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
    query_str += " ORDER BY c.cam_id ASC"

    stmt = text(query_str)
    result = await session.execute(stmt, params)
    rows = result.fetchall()

    redis = get_redis_client()
    evidence_list: List[CameraEvidence] = []
    now = datetime.now(timezone.utc)

    try:
        for row in rows:
            cam_id = row.cam_id
            redis_data = None
            try:
                cached_raw = await redis.get(f"camera_evidence:{cam_id}")
                if cached_raw:
                    redis_data = json.loads(cached_raw)
            except Exception:
                pass

            local_image_path = os.path.join("storage", "cams", f"{cam_id}.jpg")
            has_local_file = os.path.exists(local_image_path)

            if redis_data:
                evidence = CameraEvidence(**redis_data)
            else:
                spatial_status = (
                    "OBSERVED_SEGMENT_VERIFIED"
                    if row.line_of_sight_verified and row.observed_osm_way_id is not None
                    else "SPATIALLY_NEAR" if row.osm_way_id is not None
                    else "UNVERIFIED"
                )
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
                    vehicle_count=0,
                    traffic_density_score=0.0,
                    flood_ratio=0.0,
                    risk_level=RiskLevel.UNKNOWN,
                    source_status=DataSourceStatus.LIVE if has_local_file else DataSourceStatus.STALE,
                    updated_at=now,
                )
            evidence_list.append(evidence)
    finally:
        await redis.aclose()

    return evidence_list


@app.get(
    "/api/v1/cameras/{cam_id}/image",
    summary="Get camera snapshot or AI analyzed evidence overlay",
    tags=["Surveillance"],
)
async def get_camera_image(
    cam_id: str,
    session: AsyncSession = Depends(get_db),
):
    """
    Returns verified image snapshot for the given camera ID.
    Zero-Mock: Returns HTTP 404/503 if no valid verified image exists.
    Never returns sample or simulated mock images.
    """
    if not cam_id or len(cam_id) > 64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_CAMERA_ID", "message": "Malformed camera identifier."},
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

    media_type = "image/jpeg" if val.format == "JPEG" else f"image/{val.format.lower() if val.format else 'jpeg'}"
    return FileResponse(local_path, media_type=media_type)


@app.post(
    "/api/v1/routes/search",
    response_model=SafeRouteResponse,
    summary="Return verified OSRM driving candidates and evidence coverage",
    tags=["Navigation"],
)
async def search_safe_route(
    request: RouteSearchRequest,
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
