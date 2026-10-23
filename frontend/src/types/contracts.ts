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
  vehicle_count: number;
  traffic_density_score: number; // 0.0 to 1.0
  flood_ratio: number; // 0.0 to 1.0
  risk_level: RiskLevel;
  source_status: DataSourceStatus;
  updated_at: string;
}

export interface WeatherTideSignal {
  rain_mm_per_hour: number | null;
  rain_status: string;
  rain_observed_at?: string | null;
  weather_code?: number | null;
  tide_level_meters: number | null;
  tide_status: string;
  tide_station?: string | null;
  tide_datum?: string | null;
  is_high_tide_alert: boolean | null;
  timestamp: string;
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
