/**
 * SafePathAI Frontend API Service (Zero-Mock Runtime).
 * Provides client interfaces for RESTful endpoints and real-time WebSocket connection
 * with automatic reconnection, exponential backoff, and event deduplication.
 */

import {
  CameraEvidence,
  CameraImageMetadata,
  CameraSummary,
  ModelStatusResponse,
  Coordinates,
  PlaceResult,
  PlaceSearchResponse,
  RouteSearchRequest,
  SafeRouteResponse,
  WeatherTideSignal,
  WebSocketAlertMessage,
  LocationWeatherResponse,
  NearbyTrafficNewsResponse,
} from "../types/contracts";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

const SAFE_CAM_ID_REGEX = /^[a-zA-Z0-9_\-]{1,64}$/;

/**
 * Returns full URL to fetch a camera's verified snapshot with path-traversal guard.
 */
export function getCameraImageUrl(camId: string): string {
  if (!camId || !SAFE_CAM_ID_REGEX.test(camId)) {
    return "";
  }
  return `${API_BASE_URL}/api/v1/cameras/${encodeURIComponent(camId)}/image`;
}

/**
 * Returns full URL to fetch a camera's AI-assistive enhanced frame (never replaces original source evidence).
 */
export function getCameraEnhancedImageUrl(camId: string): string {
  if (!camId || !SAFE_CAM_ID_REGEX.test(camId)) {
    return "";
  }
  return `${API_BASE_URL}/api/v1/cameras/${encodeURIComponent(camId)}/image?type=enhanced`;
}

/**
 * Returns full URL to fetch a camera's AI detection overlay frame (with YOLO boxes and water segmentations).
 */
export function getCameraAnalyzedImageUrl(camId: string): string {
  if (!camId || !SAFE_CAM_ID_REGEX.test(camId)) {
    return "";
  }
  return `${API_BASE_URL}/api/v1/cameras/${encodeURIComponent(camId)}/image?type=analyzed`;
}

/**
 * Fetches structured technical metadata for a camera snapshot (provenance, eligibility, headers).
 */
export async function fetchCameraMetadata(camId: string): Promise<CameraImageMetadata> {
  if (!camId || !SAFE_CAM_ID_REGEX.test(camId)) {
    throw new Error("Mã định danh camera không hợp lệ.");
  }
  const res = await fetch(`${API_BASE_URL}/api/v1/cameras/${encodeURIComponent(camId)}/metadata`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail?.message || `Lỗi tải thông tin camera (${res.status})`);
  }
  return await res.json();
}

/**
 * Fetches the list of all registered traffic cameras across HCMC with live risk evidence.
 */
export async function fetchCameras(district?: string): Promise<CameraEvidence[]> {
  const url = new URL(`${API_BASE_URL}/api/v1/cameras`);
  if (district) {
    url.searchParams.set("district", district);
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch cameras: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } catch (error) {
    console.error("Error in fetchCameras:", error);
    throw error;
  }
}

export async function fetchCameraSummary(): Promise<CameraSummary> {
  const url = `${API_BASE_URL}/api/v1/cameras/summary`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch camera summary: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } catch (error) {
    console.error("Error in fetchCameraSummary:", error);
    throw error;
  }
}

/**
 * Computes an optimal flood-safe route between origin and destination coordinates.
 * Preserves raw OSRM ETA and reranks alternatives using multi-criteria ranking cost.
 */
export async function searchSafeRoute(
  origin: Coordinates,
  destination: Coordinates
): Promise<SafeRouteResponse> {
  const url = `${API_BASE_URL}/api/v1/routes/search`;
  const body: RouteSearchRequest = { origin, destination };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const respBody = await res.json().catch(() => null);
      const code = respBody?.detail?.code || (res.status === 503 ? "PROVIDER_DOWN" : "NO_ROUTE");
      const message = respBody?.detail?.message || "Không có tuyến đường khả dụng.";
      throw new Error(`${code}: ${message}`);
    }

    return await res.json();
  } catch (error) {
    console.error("Error in searchSafeRoute:", error);
    throw error;
  }
}

/**
 * Searches places, addresses, streets, and POIs in TP.HCM.
 */
export async function searchPlaces(
  query: string,
  limit: number = 6,
  signal?: AbortSignal
): Promise<PlaceSearchResponse> {
  const url = new URL(`${API_BASE_URL}/api/v1/places/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    method: "GET",
    signal,
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to search places: ${res.status}`);
  }

  return await res.json();
}

/**
 * Reverse geocodes coordinates to a place name/address.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<PlaceResult> {
  const url = new URL(`${API_BASE_URL}/api/v1/places/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));

  const res = await fetch(url.toString(), {
    method: "GET",
    signal,
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to reverse geocode: ${res.status}`);
  }

  return await res.json();
}

/**
 * Fetches current verified weather and tide conditions.
 */
export async function fetchWeatherTide(): Promise<WeatherTideSignal> {
  const url = `${API_BASE_URL}/api/v1/weather-tide`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to fetch weather/tide: ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error("Error in fetchWeatherTide:", error);
    throw error;
  }
}

/**
 * Fetches system health and backend connectivity metrics.
 */
export async function fetchHealth(): Promise<Record<string, any>> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/health`, { cache: "no-store" });
    if (!res.ok) return { status: "degraded" };
    return await res.json();
  } catch (error) {
    return { status: "offline", error: String(error) };
  }
}

/**
 * Connects to the real-time WebSocket alert stream at /ws/alerts.
 * Includes automatic reconnection with exponential backoff and event deduplication by event_id.
 * Returns a teardown function to close the connection cleanly.
 */
export function connectAlertsWebSocket(
  onMessage: (msg: WebSocketAlertMessage) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let isClosedManually = false;
  let reconnectAttempts = 0;
  const maxReconnectDelay = 15000;
  const seenEventIds = new Set<string>();
  const MAX_DEDUPE_SIZE = 500;

  function initSocket() {
    if (isClosedManually) return;

    try {
      ws = new WebSocket(`${WS_BASE_URL}/ws/alerts`);

      ws.onopen = () => {
        reconnectAttempts = 0;
        onStatusChange?.(true);
        console.log("[SafePathAI WS] Connected to live alert stream.");
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketAlertMessage = JSON.parse(event.data);

          // Deduplicate by event_id if present
          if (data.event_id) {
            if (seenEventIds.has(data.event_id)) {
              return;
            }
            if (seenEventIds.size >= MAX_DEDUPE_SIZE) {
              const first = seenEventIds.values().next().value;
              if (first) seenEventIds.delete(first);
            }
            seenEventIds.add(data.event_id);
          }

          onMessage(data);
        } catch (e) {
          console.warn("[SafePathAI WS] Failed parsing message:", event.data);
        }
      };

      ws.onerror = (err) => {
        console.warn("[SafePathAI WS] Connection error:", err);
      };

      ws.onclose = () => {
        onStatusChange?.(false);
        if (!isClosedManually) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), maxReconnectDelay);
          console.log(`[SafePathAI WS] Disconnected. Reconnecting in ${Math.round(delay)}ms...`);
          setTimeout(initSocket, delay);
        }
      };
    } catch (err) {
      console.warn("[SafePathAI WS] Initialization exception:", err);
      if (!isClosedManually) {
        setTimeout(initSocket, 3000);
      }
    }
  }

  initSocket();

  return () => {
    isClosedManually = true;
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}

/** Deployment status comes from the loaded model manifest, never a marketing label. */
export async function fetchModelStatus(): Promise<ModelStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/models/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được trạng thái mô hình (${response.status}).`);
  return response.json();
}

/** Fetches localized real-time weather at specific GPS coordinates */
export async function getLocationWeather(lat: number, lng: number): Promise<LocationWeatherResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/weather/location?lat=${lat}&lng=${lng}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Không tải được thời tiết vị trí (${response.status}).`);
  return response.json();
}

/** Fetches real-time municipal and verified traffic news in a radius */
export async function getNearbyTrafficNews(
  lat: number,
  lng: number,
  radiusKm = 3.0
): Promise<NearbyTrafficNewsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/traffic-news/nearby?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(`Không tải được tin giao thông gần đây (${response.status}).`);
  return response.json();
}
