"""
Database Models and Spatial Functions for SafePathAI.
Uses SQLAlchemy 2.0 with GeoAlchemy2 for PostGIS integration.
"""

from typing import Any, Coroutine, List, Optional, Union
from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Integer,
    String,
    Float,
    DateTime,
    Text,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    Session,
)
from geoalchemy2 import Geometry


class Base(DeclarativeBase):
    """Base declarative class for all SQLAlchemy ORM models."""
    pass


class RoadSegment(Base):
    """
    Represents an OpenStreetMap road segment (way) in TP.HCM.
    Stores historical flood vulnerability and spatial line geometry.
    """
    __tablename__ = "road_segments"

    osm_way_id: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, index=True, autoincrement=False
    )
    street_name: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True
    )
    is_flood_prone_history: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, index=True
    )
    geom: Mapped[Any] = mapped_column(
        Geometry(geometry_type="LINESTRING", srid=4326, spatial_index=True),
        nullable=False,
    )
    highway: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    access: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    oneway: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    bridge: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    tunnel: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    length_meters: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    osm_extract_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_license: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_pbf_md5: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    imported_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    # One-to-many relationship: One road segment can have multiple cameras assigned
    cameras: Mapped[List["TrafficCamera"]] = relationship(
        "TrafficCamera",
        back_populates="nearest_road",
        foreign_keys="TrafficCamera.nearest_osm_way_id",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return (
            f"<RoadSegment(osm_way_id={self.osm_way_id}, street='{self.street_name}', "
            f"flood_prone={self.is_flood_prone_history})>"
        )


class RoadEdge(Base):
    """Consecutive OSM Way vertices; edge_index is local, not an OSM ID."""
    __tablename__ = "road_edges"

    osm_way_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("road_segments.osm_way_id", ondelete="CASCADE"), primary_key=True
    )
    edge_index: Mapped[int] = mapped_column(primary_key=True)
    geom: Mapped[Any] = mapped_column(
        Geometry(geometry_type="LINESTRING", srid=4326, spatial_index=True), nullable=False
    )
    length_meters: Mapped[float] = mapped_column(Float, nullable=False)
    way: Mapped[RoadSegment] = relationship("RoadSegment")


class TrafficCamera(Base):
    """
    Represents a physical traffic monitoring camera in TP.HCM.
    Holds spatial coordinates, VDMS metadata, and foreign key to the nearest road segment.
    """
    __tablename__ = "traffic_cameras"

    cam_id: Mapped[str] = mapped_column(
        String(64), primary_key=True, index=True
    )
    code: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    district: Mapped[Optional[str]] = mapped_column(
        String(128), nullable=True, index=True
    )
    stream_url: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True
    )
    nearest_osm_way_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("road_segments.osm_way_id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    geom: Mapped[Any] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=True,
    )
    coordinate_source_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    coordinate_verified_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    source_uri: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    location_confidence: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    provider_snapshot_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    generated_source_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    orientation: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    permitted_use: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, default="PERMISSION_UNVERIFIED")
    snapshot_cam_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    metadata_created_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_modified_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    bearing_degrees: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    field_of_view_degrees: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    view_verified_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    view_verification_source_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    line_of_sight_verified: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    observed_osm_way_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("road_segments.osm_way_id", ondelete="SET NULL"), nullable=True
    )
    observed_edge_index: Mapped[Optional[int]] = mapped_column(nullable=True)

    # Many-to-one relationship: Camera belongs to its closest road segment
    nearest_road: Mapped[Optional["RoadSegment"]] = relationship(
        "RoadSegment", back_populates="cameras", foreign_keys=[nearest_osm_way_id]
    )

    def __repr__(self) -> str:
        return (
            f"<TrafficCamera(cam_id='{self.cam_id}', code='{self.code}', name='{self.name}', "
            f"district='{self.district}', nearest_osm_way_id={self.nearest_osm_way_id})>"
        )


class CameraIngestionState(Base):
    """
    Persistent state tracking for Camera Ingestion Scheduler.
    Records per-camera attempt history, exponential backoff, validation provenance,
    and HTTP status codes to prevent starvation and ensure fair round-robin scheduling.
    """
    __tablename__ = "camera_ingestion_state"

    cam_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("traffic_cameras.cam_id", ondelete="CASCADE"), primary_key=True, index=True
    )
    source_status: Mapped[str] = mapped_column(String(32), default="PENDING", index=True)
    last_attempt_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_success_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_captured_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_retrieved_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_retry_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    http_status: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    validation_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    image_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    image_width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    image_height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    model_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_error_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_checked_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    cached_image_path: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<CameraIngestionState({self.cam_id}, status={self.source_status}, retries={self.failure_count})>"


class HistoricalFloodPoint(Base):
    """
    Represents a verified municipal historical flood observation point in TP.HCM.
    Distinguishes historical flood records from current real-time observations.
    """
    __tablename__ = "historical_flood_points"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    street_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    district: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cause: Mapped[str] = mapped_column(String(50), nullable=False)  # TIDAL, HEAVY_RAIN, TIDAL_AND_HEAVY_RAIN
    reported_years: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    typical_depth_cm: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str] = mapped_column(String(500), nullable=False)
    confidence: Mapped[str] = mapped_column(String(50), default="OFFICIAL_MUNICIPAL_REPORT")
    geom: Mapped[Any] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=True),
        nullable=False,
    )
    matched_osm_way_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("road_segments.osm_way_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<HistoricalFloodPoint({self.id}, {self.street_name}, {self.cause})>"


class User(Base):
    """
    User account model supporting Google OAuth authentication.
    Stores stable provider identity, profile details, and account state.
    """
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    provider: Mapped[str] = mapped_column(String(32), default="google", nullable=False)
    provider_account_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    preference: Mapped[Optional["UserPreference"]] = relationship(
        "UserPreference", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    saved_places: Mapped[List["UserSavedPlace"]] = relationship(
        "UserSavedPlace", back_populates="user", cascade="all, delete-orphan", order_by="UserSavedPlace.created_at.desc()"
    )
    route_history: Mapped[List["UserRouteHistory"]] = relationship(
        "UserRouteHistory", back_populates="user", cascade="all, delete-orphan", order_by="UserRouteHistory.created_at.desc()"
    )

    def __repr__(self) -> str:
        return f"<User(id='{self.id}', email='{self.email}', display_name='{self.display_name}')>"


class UserPreference(Base):
    """User routing, flood avoidance, and notification preferences."""
    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    transport_mode: Mapped[str] = mapped_column(String(32), default="motorcycle", nullable=False)
    avoid_flood_level: Mapped[str] = mapped_column(String(32), default="MEDIUM", nullable=False)
    avoid_high_density: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    alert_notifications: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    voice_guidance_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="preference")


class UserSavedPlace(Base):
    """User favorite / bookmarked locations."""
    __tablename__ = "user_saved_places"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str] = mapped_column(String(512), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    category: Mapped[str] = mapped_column(String(32), default="favorite", nullable=False)
    created_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="saved_places")


class UserRouteHistory(Base):
    """User completed or searched route history."""
    __tablename__ = "user_route_history"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    origin_name: Mapped[str] = mapped_column(String(255), nullable=False)
    dest_name: Mapped[str] = mapped_column(String(255), nullable=False)
    origin_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    origin_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dest_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dest_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    duration_mins: Mapped[int] = mapped_column(Integer, nullable=False)
    travel_mode: Mapped[str] = mapped_column(String(32), default="motorcycle", nullable=False)
    created_at: Mapped[Optional[Any]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="route_history")


# PostGIS Spatial CTE Query for finding the nearest road segment within a given radius in meters
MAP_CAMERAS_POSTGIS_SQL = text("""
    WITH ranked_roads AS (
        SELECT 
            c.cam_id,
            r.osm_way_id,
            ROW_NUMBER() OVER (
                PARTITION BY c.cam_id 
                ORDER BY ST_Distance(cast(c.geom as geography), cast(r.geom as geography)) ASC,
                         r.osm_way_id ASC
            ) AS rn
        FROM traffic_cameras c
        JOIN road_segments r 
          ON c.geom IS NOT NULL
         AND c.coordinate_source_url IS NOT NULL
         AND c.coordinate_verified_at IS NOT NULL
         AND r.source_url IS NOT NULL
         AND ST_DWithin(cast(c.geom as geography), cast(r.geom as geography), :radius_meters)
    )
    UPDATE traffic_cameras tc
    SET nearest_osm_way_id = rr.osm_way_id
    FROM ranked_roads rr
    WHERE tc.cam_id = rr.cam_id
      AND rr.rn = 1;
""")


async def map_cameras_to_nearest_roads_async(
    db_session: AsyncSession, radius_meters: float = 80.0
) -> int:
    """
    Asynchronous implementation of PostGIS spatial mapping.
    Uses ST_DWithin and ST_Distance on geography to bind each camera to its
    closest road segment within radius_meters (default 80m).
    """
    result = await db_session.execute(
        MAP_CAMERAS_POSTGIS_SQL, {"radius_meters": radius_meters}
    )
    await db_session.commit()
    return result.rowcount or 0


def map_cameras_to_nearest_roads_sync(
    db_session: Session, radius_meters: float = 80.0
) -> int:
    """
    Synchronous implementation of PostGIS spatial mapping.
    Uses ST_DWithin and ST_Distance on geography to bind each camera to its
    closest road segment within radius_meters (default 80m).
    """
    result = db_session.execute(
        MAP_CAMERAS_POSTGIS_SQL, {"radius_meters": radius_meters}
    )
    db_session.commit()
    return result.rowcount or 0


def map_cameras_to_nearest_roads(
    db_session: Union[AsyncSession, Session], radius_meters: float = 80.0
) -> Union[Coroutine[Any, Any, int], int]:
    """
    Utility function mapping traffic cameras to their nearest road segments.
    Automatically detects whether db_session is an AsyncSession or a sync Session.

    - If AsyncSession: returns a coroutine to be awaited (`await map_cameras_to_nearest_roads(session)`).
    - If sync Session: executes synchronously and returns row count (`map_cameras_to_nearest_roads(session)`).

    PostGIS spatial logic:
    - Filters candidate road segments within :radius_meters using ST_DWithin on WGS84 geography.
    - Partitions by camera and picks the closest road segment ordered by ST_Distance.
    - Updates `traffic_cameras.nearest_osm_way_id`.
    """
    if isinstance(db_session, AsyncSession):
        return map_cameras_to_nearest_roads_async(db_session, radius_meters)
    return map_cameras_to_nearest_roads_sync(db_session, radius_meters)
