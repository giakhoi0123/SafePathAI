/**
 * SafePathAI Data Contracts (TypeScript Definition).
 * Single Source of Truth matching backend/app/schemas/contracts.py.
 * Zero-Mock: All metrics and risk categories strictly mirror verified backend contracts.
 */

export enum RiskLevel {
  SAFE = "SAFE",
  MODERATE = "MODERATE",
  CRITICAL = "CRITICAL",
  UNKNOWN = "UNKNOWN",
  INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE",
}

export enum DataSourceStatus {
  LIVE = "LIVE",
  STALE = "STALE",
  SIMULATED = "SIMULATED",
}

export enum ImageAccessStatus {
  VIEWABLE_PUBLIC = "VIEWABLE_PUBLIC",
  VIEWABLE_AUTHORIZED = "VIEWABLE_AUTHORIZED",
  EXTERNAL_ACCESS_RESTRICTED = "EXTERNAL_ACCESS_RESTRICTED",
  UNAVAILABLE = "UNAVAILABLE",
}

export enum EvidenceEligibility {
  ROUTING_ELIGIBLE = "ROUTING_ELIGIBLE",
  NOT_VERIFIED_FOR_ROUTING = "NOT_VERIFIED_FOR_ROUTING",
}

export interface ImageQualityMetrics {
  brightness_score: number;
  blur_score: number;
  noise_estimate: number;
  resolution_score: number;
  contrast_score: number;
  is_low_light: boolean;
  is_blurry: boolean;
  is_low_quality: boolean;
}

export interface ImageQualityAssessment {
  quality_status: string; // "HIGH_QUALITY", "ACCEPTABLE", "POOR", "DEGRADED"
  quality_flags: string[]; // ["LOW_LIGHT", "LOW_RESOLUTION", "BLURRY", "NOISY", "PARTIAL_OCCLUSION"]
  quality_metrics: ImageQualityMetrics;
  enhancement_applied: boolean;
  enhancement_mode?: string | null;
  enhanced_image_url?: string | null;
  super_resolution_status?: string | null;
}

export interface CameraSummary {
  total_registered: number;
  valid_gps_count: number;
  checked_count: number;
  valid_images_count: number;
  stale_images_count: number;
  unavailable_count: number;
  analyzed_count: number;
  last_scheduler_cycle: string | null;
  circuit_breaker_open: boolean;
  cycle_target_sec?: number;
  cycle_checked_count?: number | null;
  cycle_pending_count?: number | null;
}

export interface CameraEvidence {
  cam_id: string;
  code?: string | null;
  name: string;
  district?: string | null;
  lat: number;
  lng: number;
  osm_way_id?: number | null;
  coordinate_source_url?: string | null;
  spatial_match_status?: string;
  observed_osm_way_id?: number | null;
  observed_edge_index?: number | null;
  view_verification_source_url?: string | null;
  line_of_sight_verified?: boolean;
  image_url: string;
  has_image?: boolean;
  image_access_status?: ImageAccessStatus;
  evidence_eligibility?: EvidenceEligibility;
  captured_at?: string | null;
  retrieved_at?: string | null;
  analyzed_at?: string | null;
  source_updated_at?: string | null;
  source_url?: string | null;
  image_status?: string | null;
  image_status_reason?: string | null;
  model_status?: string | null;
  vehicle_model_name?: string | null;
  vehicle_model_version?: string | null;
  vehicle_model_sha256?: string | null;
  vehicle_model_provenance?: string | null;
  vehicle_model_validation?: string | null;
  flood_model_status?: string | null;
  vehicle_count?: number | null;
  traffic_density_score?: number | null; // 0.0 to 1.0, null when unanalyzed
  flood_ratio?: number | null; // 0.0 to 1.0, null when unanalyzed
  image_quality?: ImageQualityAssessment | null;
  enhanced_image_url?: string | null;
  enhancement_applied?: boolean;
  model_pipeline?: string | null;
  risk_level: RiskLevel;
  source_status: DataSourceStatus;
  updated_at: string;
}

export interface CameraImageMetadata {
  cam_id: string;
  code?: string | null;
  name: string;
  district?: string | null;
  lat: number;
  lng: number;
  has_image: boolean;
  image_url?: string | null;
  source_url?: string | null;
  image_access_status: ImageAccessStatus;
  evidence_eligibility: EvidenceEligibility;
  image_status_reason: string;
  captured_at?: string | null;
  retrieved_at?: string | null;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  analyzed_at?: string | null;
  source_updated_at?: string | null;
  model_status?: string | null;
  vehicle_count?: number | null;
  traffic_density_score?: number | null;
  flood_ratio?: number | null;
  image_quality?: ImageQualityAssessment | null;
  enhanced_image_url?: string | null;
  enhancement_applied?: boolean;
  model_pipeline?: string | null;
  etag?: string | null;
  image_hash?: string | null;
  content_length?: number | null;
  mime_type?: string | null;
}

export interface ActiveCameraResponse {
  status: string;
  registered_count: number;
  active_viewed_count: number;
  active_route_count: number;
}

export interface WeatherTideSignal {
  rain_mm_per_hour: number | null;
  rain_status: string;
  rain_observed_at?: string | null;
  weather_code?: number | null;
  tide_level_meters: number | null;
  tide_status: string;
  tide_observed_at?: string | null;
  tide_source_url?: string | null;
  tide_station?: string | null;
  tide_datum?: string | null;
  is_high_tide_alert: boolean | null;
  timestamp: string | null;
  source_url?: string | null;
}

export interface RouteSegmentRisk {
  osm_way_id: number | null;
  osm_edge_index?: number | null;
  candidate_osm_way_ids?: number[];
  candidate_road_edges?: { osm_way_id: number; edge_index: number }[];
  road_match_status?: string;
  geojson_path?: { type: "LineString"; coordinates: number[][] } | null;
  street_name?: string | null;
  length_meters: number;
  maneuver_type?: string | null;
  maneuver_modifier?: string | null;
  maneuver_location?: number[] | null;
  maneuver_exit?: number | null;
  risk_score: number | null;
  risk_level: RiskLevel;
  historical_flood_prone?: boolean | null;
  historical_flood_cause?: string | null;
  historical_typical_depth_cm?: number | null;
  weather_risk?: string | null;
  evidence_coverage?: string;
  evidence_cameras: CameraEvidence[];
  freshness_seconds?: number | null;
}

export interface SafeRouteResponse {
  route_id: string;
  total_distance_km: number;
  estimated_time_mins: number;
  ranking_cost?: number | null;
  overall_risk: RiskLevel;
  route_status?: string;
  evidence_coverage?: string;
  critical_segments_count?: number;
  moderate_segments_count?: number;
  unknown_segments_count?: number;
  geojson_path: {
    type: string;
    coordinates: number[][] | number[][][];
    [key: string]: any;
  };
  segments: RouteSegmentRisk[];
  ai_explanation: string;
  alternative_routes?: SafeRouteResponse[];
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteSearchRequest {
  origin: Coordinates;
  destination: Coordinates;
}

export interface WebSocketAlertMessage {
  event_id: string;
  type: string;
  severity: string;
  source: string;
  cam_id?: string;
  code?: string;
  location?: string;
  flood_ratio?: number;
  risk_level?: RiskLevel;
  message: string;
  observed_at: string;
  expiry?: string | null;
}

export interface PlaceResult {
  id: string;
  name: string;
  display_name: string;
  lat: number;
  lng: number;
  osm_type?: string | null;
  osm_id?: number | null;
  type?: string | null;
  district?: string | null;
  city?: string | null;
  provenance: string;
}

export interface PlaceSearchResponse {
  query: string;
  results: PlaceResult[];
  provider: string;
  count: number;
}

export type NavigationUXState =
  | "IDLE"
  | "SEARCHING_PLACE"
  | "LOCATION_REQUESTING"
  | "READY_TO_ROUTE"
  | "ROUTING"
  | "ROUTE_FOUND"
  | "NO_ROUTE"
  | "PROVIDER_DOWN"
  | "NAVIGATING";

export type MapSelectionMode = "ORIGIN" | "DESTINATION" | "NONE";

export interface ModelStatusResponse {
  vehicle_detector: ModelDeploymentStatus;
  flood_segmenter: ModelDeploymentStatus;
}
export interface ModelDeploymentStatus {
  status: string;
  model_name: string | null;
  version: string | null;
  sha256: string | null;
  source_url: string | null;
  provenance_status?: string | null;
  deployment_validation?: string | null;
}

export interface LocationWeatherResponse {
  lat: number;
  lng: number;
  temperature_c?: number | null;
  humidity_pct?: number | null;
  rain_mm_per_hour?: number | null;
  rain_probability_pct?: number | null;
  wind_speed_kmh?: number | null;
  weather_code?: number | null;
  weather_description: string;
  observed_at?: string | null;
  freshness_seconds?: number | null;
  status: string;
  source_url: string;
}

export interface TrafficNewsItem {
  id: string;
  canonical_url?: string;
  title: string;
  summary: string;
  source?: string;
  source_name?: string;
  category: string;
  severity: string;
  event_status?: string;
  published_at?: string | null;
  fetched_at?: string;
  event_at?: string | null;
  expires_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_km?: number | null;
  location_confidence?: string;
  geocoding_status?: string;
  verification_status?: string;
  image_url?: string | null;
  link?: string | null;
}

export interface NearbyTrafficNewsResponse {
  lat: number;
  lng: number;
  radius_km: number;
  count: number;
  items: TrafficNewsItem[];
  status: string;
  message: string;
  fetched_at: string;
}

export interface TrafficNewsListResponse {
  total: number;
  count: number;
  items: TrafficNewsItem[];
  fetched_at: string;
}

export interface TrafficNewsSummaryResponse {
  total_articles: number;
  active_hazards: number;
  resolved_locations_count: number;
  categories: Record<string, number>;
  sources: Record<string, {
    name: string;
    status: string;
    type: string;
    last_check?: string;
  }>;
  latest_update?: string | null;
  fetched_at: string;
}

export interface TrafficNewsHighlightsResponse {
  count: number;
  items: TrafficNewsItem[];
  fetched_at: string;
}
