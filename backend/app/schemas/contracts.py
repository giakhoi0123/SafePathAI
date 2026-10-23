"""
Data Contracts and Schema Definitions (Single Source of Truth).
Defines all domain models, enums, and API transfer schemas for SafePathAI.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class RiskLevel(str, Enum):
    """
    Standard risk level classification used across all risk calculations.
    """
    SAFE = "SAFE"
    MODERATE = "MODERATE"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


class DataSourceStatus(str, Enum):
    """
    Status of the underlying data source to ensure transparency in UI.
    - LIVE: Fresh data updated within expected interval (< 120s).
    - STALE: Data source is delayed or connection dropped temporarily.
    - SIMULATED: Data generated from mock fixtures for demonstration or fallback.
    """
    LIVE = "LIVE"
    STALE = "STALE"
    SIMULATED = "SIMULATED"


class CameraEvidence(BaseModel):
    """
    Detailed evidence payload collected from a single traffic camera.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    cam_id: str = Field(..., description="Unique camera identifier in VDMS / database")
    code: Optional[str] = Field(default=None, description="Camera code label (e.g. 'TTH 35.4')")
    name: str = Field(..., description="Descriptive camera location name")
    district: Optional[str] = Field(default=None, description="Administrative district of the camera")
    lat: float = Field(..., ge=-90.0, le=90.0, description="WGS84 Latitude")
    lng: float = Field(..., ge=-180.0, le=180.0, description="WGS84 Longitude")
    osm_way_id: Optional[int] = Field(default=None, description="Associated nearest OSM Way ID")
    coordinate_source_url: Optional[str] = Field(default=None, description="Independent source of camera GPS")
    spatial_match_status: str = Field(default="UNVERIFIED", description="SPATIALLY_NEAR or OBSERVED_SEGMENT_VERIFIED")
    observed_osm_way_id: Optional[int] = Field(default=None, description="Manually verified road Way in camera view")
    observed_edge_index: Optional[int] = Field(default=None, description="Verified local edge index within the OSM Way")
    view_verification_source_url: Optional[str] = Field(default=None, description="Evidence for view direction and observed road")
    line_of_sight_verified: bool = Field(default=False, description="Whether obstacles were checked")
    image_url: str = Field(..., description="URL or static path to camera image snapshot")
    vehicle_count: int = Field(..., ge=0, description="Number of vehicles detected by computer vision")
    traffic_density_score: float = Field(
        ..., ge=0.0, le=1.0, description="Normalized traffic congestion score (0.0 to 1.0)"
    )
    flood_ratio: float = Field(
        ..., ge=0.0, le=1.0, description="Water segmentation ratio of the road surface (0.0 to 1.0)"
    )
    risk_level: RiskLevel = Field(..., description="Computed risk level for this camera feed")
    source_status: DataSourceStatus = Field(..., description="Current status of the camera feed")
    updated_at: datetime = Field(..., description="Timestamp when evidence was processed")


class WeatherTideSignal(BaseModel):
    """
    Hydrometeorological signal combining rain intensity and tidal level.
    Zero-Mock: All metric fields are nullable when unobserved; never defaults to 0 mm/h or fake tide.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    rain_mm_per_hour: Optional[float] = Field(default=None, ge=0.0, description="Hourly rainfall in millimeters; None if unobserved")
    rain_status: str = Field(default="WEATHER_UNAVAILABLE", description="LIVE, STALE, or WEATHER_UNAVAILABLE")
    rain_observed_at: Optional[datetime] = Field(default=None, description="Observation timestamp from meteorological service")
    weather_code: Optional[int] = Field(default=None, description="WMO weather code (e.g. 51-65 rain)")
    tide_level_meters: Optional[float] = Field(default=None, description="Tidal water level in meters relative to datum; None if unobserved")
    tide_status: str = Field(default="TIDE_UNAVAILABLE", description="LIVE, STALE, or TIDE_UNAVAILABLE")
    tide_station: Optional[str] = Field(default=None, description="Observing tidal station name (e.g. Phú An, Nhà Bè)")
    tide_datum: Optional[str] = Field(default=None, description="Vertical datum (e.g. Hòn Dấu VN-2000)")
    is_high_tide_alert: Optional[bool] = Field(default=None, description="True if tide exceeds warning threshold; None if unobserved")
    timestamp: datetime = Field(..., description="Signal recording timestamp")
    source_url: Optional[str] = Field(default=None, description="Source URL of environmental data")


class RouteSegmentRisk(BaseModel):
    """
    Risk assessment for a specific OpenStreetMap road segment.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    osm_way_id: Optional[int] = Field(default=None, description="Verified OpenStreetMap Way ID, if available")
    osm_edge_index: Optional[int] = Field(default=None, description="Verified local edge index within the OSM Way")
    candidate_osm_way_ids: List[int] = Field(default_factory=list, description="Nearby real OSM Ways; candidate only")
    candidate_road_edges: List[Dict[str, int]] = Field(default_factory=list, description="Nearby OSM Way/edge_index pairs; candidate only")
    road_match_status: str = Field(default="UNKNOWN", description="CANDIDATE_ONLY or NO_ROAD_EDGE_MATCH")
    geojson_path: Optional[Dict[str, Any]] = Field(default=None, description="Actual OSRM step LineString")
    street_name: Optional[str] = Field(default=None, description="Human-readable street name")
    length_meters: float = Field(..., ge=0.0, description="Segment length in meters")
    risk_score: Optional[float] = Field(
        default=None, ge=0.0, le=100.0, description="Verified risk score, absent when evidence is insufficient"
    )
    risk_level: RiskLevel = Field(..., description="Risk category for this segment")
    historical_flood_prone: Optional[bool] = Field(default=None, description="True if documented in municipal flood reports, None if unverified")
    historical_flood_cause: Optional[str] = Field(default=None, description="TIDAL, HEAVY_RAIN, or TIDAL_AND_HEAVY_RAIN")
    historical_typical_depth_cm: Optional[int] = Field(default=None, description="Typical flood depth from municipal reports")
    weather_risk: Optional[str] = Field(default=None, description="CLEAR, MODERATE_RAIN, HEAVY_RAIN, or UNKNOWN")
    evidence_coverage: str = Field(default="UNAVAILABLE", description="Verified observation coverage in the segment corridor")
    evidence_cameras: List[CameraEvidence] = Field(
        default_factory=list, description="List of cameras mapped or buffered to this road segment"
    )
    freshness_seconds: Optional[float] = Field(default=None, description="Seconds since most recent verified observation")


class SafeRouteResponse(BaseModel):
    """
    Complete response returned by the safe route finding API.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    route_id: str = Field(..., description="Unique route query identification UUID")
    total_distance_km: float = Field(..., ge=0.0, description="Total distance of the route in km")
    estimated_time_mins: float = Field(..., ge=0.0, description="Estimated travel time in minutes from OSRM duration (never distorted)")
    ranking_cost: Optional[float] = Field(default=None, description="Objective multi-criteria cost used strictly for candidate route ranking")
    overall_risk: RiskLevel = Field(..., description="Overall aggregate risk level for the entire route")
    route_status: str = Field(default="ROUTE_FOUND_RISK_UNKNOWN", description="Route and evidence coverage status")
    evidence_coverage: str = Field(default="UNAVAILABLE", description="Coverage of verified risk observations")
    critical_segments_count: int = Field(default=0, description="Count of verified critical risk road segments")
    moderate_segments_count: int = Field(default=0, description="Count of verified moderate risk road segments")
    unknown_segments_count: int = Field(default=0, description="Count of unobserved or unknown risk road segments")
    geojson_path: Dict[str, Any] = Field(
        ..., description="GeoJSON Feature/Geometry representing the full navigation line"
    )
    segments: List[RouteSegmentRisk] = Field(
        ..., description="Sequential list of road segments and their associated risk assessments"
    )
    ai_explanation: str = Field(
        ..., description="AI-generated plain-language rationale explaining route choice and warnings"
    )
    alternative_routes: List["SafeRouteResponse"] = Field(
        default_factory=list, description="Alternative candidate routes evaluated"
    )


class Coordinates(BaseModel):
    """Geographic point coordinates."""
    model_config = ConfigDict(from_attributes=True)

    lat: float = Field(..., ge=-90.0, le=90.0, description="WGS84 Latitude")
    lng: float = Field(..., ge=-180.0, le=180.0, description="WGS84 Longitude")


class RouteSearchRequest(BaseModel):
    """Payload for finding a safe driving route between two points."""
    model_config = ConfigDict(from_attributes=True)

    origin: Coordinates = Field(..., description="Starting point coordinates")
    destination: Coordinates = Field(..., description="Destination point coordinates")


class WebSocketAlertMessage(BaseModel):
    """Real-time structured alert message broadcast over WebSocket."""
    model_config = ConfigDict(from_attributes=True)

    event_id: str = Field(..., description="Unique UUID for this alert event to enable client deduplication")
    type: str = Field(..., description="Alert event type, e.g. CRITICAL_FLOOD_ALERT, CONNECTION_ESTABLISHED")
    severity: str = Field(default="INFO", description="CRITICAL, WARNING, or INFO")
    source: str = Field(..., description="Evidence source, e.g. 'camera_vision:ONNX', 'hydrology:open_meteo'")
    cam_id: Optional[str] = Field(default=None, description="Camera ID if triggered by surveillance feed")
    code: Optional[str] = Field(default=None, description="Camera code label")
    location: Optional[str] = Field(default=None, description="Street or district location")
    flood_ratio: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    risk_level: Optional[RiskLevel] = Field(default=None)
    message: str = Field(..., description="Human-readable alert message")
    observed_at: datetime = Field(..., description="Observation timestamp")
    expiry: Optional[datetime] = Field(default=None, description="Expiration time after which alert is stale")


