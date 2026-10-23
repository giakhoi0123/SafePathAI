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


class ImageAccessStatus(str, Enum):
    """
    Reflects the actual accessibility and viewing status of a camera image snapshot.
    """
    VIEWABLE_PUBLIC = "VIEWABLE_PUBLIC"
    VIEWABLE_AUTHORIZED = "VIEWABLE_AUTHORIZED"
    EXTERNAL_ACCESS_RESTRICTED = "EXTERNAL_ACCESS_RESTRICTED"
    UNAVAILABLE = "UNAVAILABLE"


class EvidenceEligibility(str, Enum):
    """
    Verification gate for camera evidence in route risk scoring:
    - ROUTING_ELIGIBLE: ONLY when source permission, verified capture timestamp,
      camera positioning/FOV/LOS, and verified CV model results are all confirmed.
    - NOT_VERIFIED_FOR_ROUTING: Default for unverified, view-only, or candidate cameras.
    """
    ROUTING_ELIGIBLE = "ROUTING_ELIGIBLE"
    NOT_VERIFIED_FOR_ROUTING = "NOT_VERIFIED_FOR_ROUTING"


class ImageQualityMetrics(BaseModel):
    """
    Granular image quality metrics evaluated on camera snapshots.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    brightness_score: float = Field(..., description="Mean luminance [0.0, 255.0]")
    blur_score: float = Field(..., description="Laplacian variance sharpness score")
    noise_estimate: float = Field(..., description="High-frequency noise estimate")
    resolution_score: float = Field(..., description="Normalized resolution factor against 640x480")
    contrast_score: float = Field(..., description="Standard deviation of grayscale intensities")
    is_low_light: bool = Field(..., description="True if scene luminance is below dark threshold")
    is_blurry: bool = Field(..., description="True if blur_score is below sharpness threshold")
    is_low_quality: bool = Field(..., description="True if dark, blurry, noisy, or low-resolution")


class ImageQualityAssessment(BaseModel):
    """
    Comprehensive quality status and enhancement metadata for a camera frame.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    quality_status: str = Field(..., description="HIGH_QUALITY, ACCEPTABLE, POOR, or DEGRADED")
    quality_flags: list[str] = Field(
        default_factory=list,
        description="Quality flags: LOW_LIGHT, LOW_RESOLUTION, BLURRY, NOISY, PARTIAL_OCCLUSION",
    )
    quality_metrics: ImageQualityMetrics
    enhancement_applied: bool = Field(default=False, description="Whether enhancement pipeline was applied")
    enhancement_mode: Optional[str] = Field(default=None, description="classic, classic+sr, or none")
    enhanced_image_url: Optional[str] = Field(default=None, description="URL to view enhanced assistive frame")
    super_resolution_status: Optional[str] = Field(default=None, description="Status of super-resolution model")


class CameraEvidence(BaseModel):
    """
    Detailed evidence payload collected from a single traffic camera.
    Zero-Mock: All metric fields (vehicle_count, traffic_density_score, flood_ratio)
    are None when unobserved or unanalyzed. None != 0.
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
    image_url: str = Field(default="", description="URL or static path to camera image snapshot")
    has_image: bool = Field(default=False, description="Whether a valid snapshot is currently cached and viewable")
    image_access_status: ImageAccessStatus = Field(
        default=ImageAccessStatus.UNAVAILABLE, description="Real accessibility of image snapshot"
    )
    evidence_eligibility: EvidenceEligibility = Field(
        default=EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING,
        description="Verification gate for route risk scoring",
    )
    captured_at: Optional[datetime] = Field(default=None, description="Physical frame capture timestamp")
    retrieved_at: Optional[datetime] = Field(default=None, description="System fetch timestamp")
    analyzed_at: Optional[datetime] = Field(default=None, description="ML inference completion timestamp")
    source_updated_at: Optional[datetime] = Field(default=None, description="Portal origin update timestamp")
    source_url: Optional[str] = Field(default=None, description="External origin URL for public view reference")
    image_status: Optional[str] = Field(default=None, description="Technical status of image frame")
    image_status_reason: Optional[str] = Field(default=None, description="Reason code explaining image status")
    model_status: Optional[str] = Field(default=None, description="Status of vision models")
    vehicle_model_name: Optional[str] = None
    vehicle_model_version: Optional[str] = None
    vehicle_model_sha256: Optional[str] = None
    vehicle_model_provenance: Optional[str] = None
    vehicle_model_validation: Optional[str] = None
    flood_model_status: Optional[str] = None
    vehicle_count: Optional[int] = Field(
        default=None, ge=0, description="Number of vehicles detected; None when unobserved or unanalyzed"
    )
    traffic_density_score: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="Normalized traffic congestion score; None when unanalyzed"
    )
    flood_ratio: Optional[float] = Field(
        default=None, ge=0.0, le=1.0, description="Water segmentation ratio; None when unanalyzed"
    )
    image_quality: Optional[ImageQualityAssessment] = Field(
        default=None, description="Detailed quality assessment and enhancement flags"
    )
    enhanced_image_url: Optional[str] = Field(
        default=None, description="URL to AI-assistive enhanced frame (never replaces original source evidence)"
    )
    enhancement_applied: bool = Field(
        default=False, description="Whether enhancement was applied before inference"
    )
    model_pipeline: Optional[str] = Field(
        default=None, description="Name of the vision and enhancement pipeline used"
    )
    risk_level: RiskLevel = Field(..., description="Computed risk level for this camera feed")
    source_status: DataSourceStatus = Field(..., description="Current status of the camera feed")
    updated_at: datetime = Field(..., description="Timestamp when evidence was processed")


class CameraImageMetadata(BaseModel):
    """
    Dedicated metadata response describing snapshot availability, provenance, ETag,
    access control, and eligibility reasons without serving large image bytes.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    cam_id: str
    code: Optional[str] = None
    name: str
    district: Optional[str] = None
    lat: float
    lng: float
    has_image: bool
    image_url: Optional[str] = None
    source_url: Optional[str] = None
    image_access_status: ImageAccessStatus
    evidence_eligibility: EvidenceEligibility
    image_status_reason: str
    captured_at: Optional[datetime] = None
    retrieved_at: Optional[datetime] = None
    analyzed_at: Optional[datetime] = None
    source_updated_at: Optional[datetime] = None
    model_status: Optional[str] = None
    vehicle_count: Optional[int] = None
    traffic_density_score: Optional[float] = None
    flood_ratio: Optional[float] = None
    image_quality: Optional[ImageQualityAssessment] = None
    enhanced_image_url: Optional[str] = None
    enhancement_applied: bool = False
    model_pipeline: Optional[str] = None
    etag: Optional[str] = None
    content_length: Optional[int] = None
    mime_type: Optional[str] = None


class CameraSummary(BaseModel):
    """
    Summary operational statistics of registered cameras and ingestion status.
    Directly reflects real PostGIS and scheduler database counts (Zero-Mock).
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    total_registered: int = Field(..., description="Total cameras registered in database")
    valid_gps_count: int = Field(..., description="Number of cameras with valid WGS84 GPS coordinates")
    checked_count: int = Field(..., description="Number of cameras checked by ingestion scheduler")
    valid_images_count: int = Field(..., description="Number of cameras with live valid images (within 15m)")
    stale_images_count: int = Field(..., description="Number of cameras with stale images (>15m)")
    unavailable_count: int = Field(..., description="Number of cameras currently unreachable or offline")
    analyzed_count: int = Field(..., description="Number of cameras processed by vision models")
    last_scheduler_cycle: Optional[datetime] = Field(default=None, description="Timestamp of latest scheduler fetch attempt")
    circuit_breaker_open: bool = Field(default=False, description="Whether HCMC traffic portal circuit breaker is open")


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
    timestamp: Optional[datetime] = Field(default=None, description="Source observation timestamp; None when neither signal was observed")
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
    maneuver_type: Optional[str] = Field(default=None, description="Raw OSRM step maneuver type")
    maneuver_modifier: Optional[str] = Field(default=None, description="Raw OSRM turn direction modifier")
    maneuver_location: Optional[List[float]] = Field(default=None, description="Raw OSRM maneuver point [longitude, latitude]")
    maneuver_exit: Optional[int] = Field(default=None, description="Raw OSRM roundabout exit number")
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


class PlaceResult(BaseModel):
    """Geocoded place, address, or POI candidate."""
    model_config = ConfigDict(from_attributes=True)

    id: str = Field(..., description="Unique identifier for the place")
    name: str = Field(..., description="Short place or street name")
    display_name: str = Field(..., description="Full formatted address or landmark name")
    lat: float = Field(..., ge=-90.0, le=90.0, description="WGS84 Latitude")
    lng: float = Field(..., ge=-180.0, le=180.0, description="WGS84 Longitude")
    osm_type: Optional[str] = Field(default=None, description="OSM node/way/relation type")
    osm_id: Optional[int] = Field(default=None, description="OSM entity ID")
    type: Optional[str] = Field(default=None, description="Feature type (e.g. street, poi, amenity)")
    district: Optional[str] = Field(default=None, description="District or county name")
    city: Optional[str] = Field(default=None, description="City or province name")
    provenance: str = Field(default="photon.komoot.io", description="Data provenance of this geocoded location")


class PlaceSearchResponse(BaseModel):
    """Response containing place search results and provenance metadata."""
    model_config = ConfigDict(from_attributes=True)

    query: str = Field(..., description="Normalized search query string")
    results: List[PlaceResult] = Field(default_factory=list, description="List of matched locations")
    provider: str = Field(..., description="Geocoding provider used (photon, postgis, or fallback)")
    count: int = Field(..., description="Number of results returned")


class UserSyncRequest(BaseModel):
    """Payload to synchronize Google OAuth identity to backend database."""
    model_config = ConfigDict(from_attributes=True)

    provider: str = Field(default="google", description="OAuth provider name")
    provider_account_id: str = Field(..., description="Provider stable unique account ID (Google sub)")
    email: str = Field(..., description="User verified email address")
    display_name: str = Field(..., description="User display name")
    avatar_url: Optional[str] = Field(default=None, description="Avatar image URL")


class UserPreferenceDTO(BaseModel):
    """User preferences schema."""
    model_config = ConfigDict(from_attributes=True)

    transport_mode: str = Field(default="motorcycle", description="motorcycle, car, bicycle, walk")
    avoid_flood_level: str = Field(default="MEDIUM", description="LOW, MEDIUM, HIGH")
    avoid_high_density: bool = Field(default=False)
    alert_notifications: bool = Field(default=True)
    voice_guidance_enabled: bool = Field(default=True)


class UserSavedPlaceDTO(BaseModel):
    """Saved place schema."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    address: str
    lat: float
    lng: float
    category: str = "favorite"
    created_at: Optional[datetime] = None


class UserRouteHistoryDTO(BaseModel):
    """Route history schema."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    origin_name: str
    dest_name: str
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lng: Optional[float] = None
    distance_km: float
    duration_mins: int
    travel_mode: str = "motorcycle"
    created_at: Optional[datetime] = None


class UserProfileResponse(BaseModel):
    """Full user profile response."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str
    avatar_url: Optional[str] = None
    is_active: bool = True
    preferences: UserPreferenceDTO
    saved_places: List[UserSavedPlaceDTO] = Field(default_factory=list)
    route_history: List[UserRouteHistoryDTO] = Field(default_factory=list)


class CreateSavedPlaceRequest(BaseModel):
    """Request to create a saved place."""
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(..., min_length=1, max_length=255)
    address: str = Field(..., min_length=1, max_length=512)
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    category: str = Field(default="favorite")


class CreateRouteHistoryRequest(BaseModel):
    """Request to store a completed route in user history."""
    model_config = ConfigDict(from_attributes=True)

    origin_name: str = Field(..., min_length=1, max_length=255)
    dest_name: str = Field(..., min_length=1, max_length=255)
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lng: Optional[float] = None
    distance_km: float = Field(..., ge=0.0)
    duration_mins: int = Field(..., ge=0)
    travel_mode: str = Field(default="motorcycle")

