/**
 * SafePathAI Frontend API Service (Zero-Mock Runtime).
 * Provides client interfaces for RESTful endpoints and real-time WebSocket connection
 * with automatic reconnection, exponential backoff, and event deduplication.
 */

import {
  CameraEvidence,
  Coordinates,
  RouteSearchRequest,
  SafeRouteResponse,
  WeatherTideSignal,
  WebSocketAlertMessage,
} from "../types/contracts";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const WS_BASE_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

/**
 * Returns full URL to fetch a camera's verified snapshot.
 */
export function getCameraImageUrl(camId: string): string {
  return `${API_BASE_URL}/api/v1/cameras/${encodeURIComponent(camId)}/image`;
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
