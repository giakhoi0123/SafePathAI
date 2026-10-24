/**
 * Presentation helpers for timestamped observations.
 *
 * Safety rules:
 * - Never manufacture rainfall, tidal levels, camera frames, or water evidence.
 * - "LIVE" requires a real, fresh, source-verified capture timestamp.
 * - A cached or inaccessible frame is not proof of current road safety.
 */
import {
  DataSourceStatus,
  EvidenceEligibility,
  type CameraEvidence,
  type WeatherTideSignal,
} from "../types/contracts";

const CAMERA_TTL_MS = 30 * 60 * 1000; // Backend CAMERA_IMAGE_TTL_SECONDS = 1800
const CLOCK_SKEW_MS = 60 * 1000;

function epoch(value?: string | null): number | null {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

/** Format a provider timestamp in Vietnam local time, or show unknown explicitly. */
export function observationTime(value?: string | null): string {
  const at = epoch(value);
  if (at === null) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

/** Only return measured, currently available rain rates; never substitute zero. */
export function currentRain(
  weather: WeatherTideSignal | null | undefined,
  now: number = Date.now()
): number | null {
  if (weather?.rain_status !== "LIVE") return null;
  const value = weather.rain_mm_per_hour;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const observed = epoch(weather.rain_observed_at);
  if (observed !== null && (observed > now + CLOCK_SKEW_MS || now - observed > 2 * 60 * 60 * 1000)) return null;
  return value;
}

/** Tide is unknown until the source publishes a verified current bulletin. */
export function currentTide(
  weather: WeatherTideSignal | null | undefined,
  now: number = Date.now()
): number | null {
  if (weather?.tide_status !== "LIVE") return null;
  const value = weather.tide_level_meters;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const observed = epoch(weather.tide_observed_at);
  if (observed !== null && (observed > now + CLOCK_SKEW_MS || now - observed > 4 * 60 * 60 * 1000)) return null;
  return value;
}

export type CameraObservationStatus = "LIVE" | "STALE" | "UNAVAILABLE";

/** Show the provider's state; never promote a stale/unverified frame to LIVE. */
export function cameraObservationStatus(
  camera: CameraEvidence | null | undefined,
  now: number = Date.now()
): CameraObservationStatus {
  if (!camera?.has_image) return "UNAVAILABLE";
  if (camera.source_status !== DataSourceStatus.LIVE) {
    return camera.source_status === DataSourceStatus.STALE ? "STALE" : "UNAVAILABLE";
  }
  const captured = epoch(camera.captured_at);
  if (captured === null || captured > now + CLOCK_SKEW_MS || now - captured > CAMERA_TTL_MS) return "STALE";
  return "LIVE";
}

/** Water map points need actual ONNX segmentation and routing-grade spatial evidence. */
export function hasVerifiedFloodObservation(camera: CameraEvidence): boolean {
  return (
    cameraObservationStatus(camera) === "LIVE" &&
    camera.evidence_eligibility === EvidenceEligibility.ROUTING_ELIGIBLE &&
    camera.line_of_sight_verified === true &&
    camera.flood_model_status === "VERIFIED_ONNX_INFERENCE" &&
    typeof camera.flood_ratio === "number" &&
    Number.isFinite(camera.flood_ratio) &&
    camera.flood_ratio >= 0 &&
    camera.flood_ratio <= 1
  );
}
