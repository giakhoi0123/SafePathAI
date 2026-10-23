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
