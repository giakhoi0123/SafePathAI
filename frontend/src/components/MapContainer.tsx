"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CameraEvidence, Coordinates, MapSelectionMode, RouteSegmentRisk, SafeRouteResponse } from "../types/contracts";
import { Camera, MapPin } from "lucide-react";
import GlassToggle, { CameraFilterMode } from "./Glass/GlassToggle";

interface MapContainerProps {
  cameras: CameraEvidence[];
  recommendedRoute: SafeRouteResponse | null;
  alternativeRoutes: SafeRouteResponse[];
  highlightedSegment?: RouteSegmentRisk | null;
  origin: Coordinates | null;
  destination: Coordinates | null;
  currentLocation?: { lat: number; lng: number; accuracy?: number } | null;
  locationFocusToken?: number;
  mapSelectionMode?: MapSelectionMode;
  onMapClickCoordinates: (coords: Coordinates) => void;
  onSelectCamera: (camera: CameraEvidence) => void;
  onSelectRoute?: (route: SafeRouteResponse) => void;
  onRequestCurrentLocation?: () => void;
  isRequestingLocation?: boolean;
  showCameras?: boolean;
  onToggleCameras?: (show: boolean) => void;
}

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const cameraNearRoute = (lng: number, lat: number, coords?: number[][]) => {
  if (!coords || coords.length < 2) return false;
  const scale = Math.cos((lat * Math.PI) / 180);
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    const dx = (bLng - aLng) * scale;
    const dy = bLat - aLat;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((lng - aLng) * scale * dx + (lat - aLat) * dy) / length)) : 0;
    if (Math.hypot((lng - aLng) * scale - t * dx, lat - aLat - t * dy) < 0.0008) return true;
  }
  return false;
};
const lineFeature = (route: SafeRouteResponse): GeoJSON.Feature => ({
  type: "Feature",
  properties: { routeId: route.route_id },
  geometry: route.geojson_path as GeoJSON.LineString,
});
const setSource = (map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) =>
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);

export const MapContainer: React.FC<MapContainerProps> = ({
  cameras,
  recommendedRoute,
  alternativeRoutes,
  highlightedSegment,
  origin,
  destination,
  currentLocation,
  locationFocusToken = 0,
  mapSelectionMode = "NONE",
  onMapClickCoordinates,
  onSelectCamera,
  onSelectRoute,
  showCameras: controlledShowCameras,
  onToggleCameras,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const callbacksRef = useRef({ onMapClickCoordinates, onSelectCamera, onSelectRoute });
  const [internalShowCameras, setInternalShowCameras] = useState(true);
  const [cameraFilter, setCameraFilter] = useState<CameraFilterMode>("ALL");
  const isControlled = typeof controlledShowCameras === "boolean";
  const showCameras = isControlled ? controlledShowCameras : internalShowCameras;

  const dataRef = useRef({
    cameras,
    recommendedRoute,
    alternativeRoutes,
    highlightedSegment,
    mapSelectionMode,
    showCameras,
    cameraFilter,
  });
  const markerRef = useRef<maplibregl.Marker[]>([]);
  const lastLocationFocusRef = useRef(0);
  const lastFitRouteRef = useRef<string | null>(null);
  const cameraPreferenceSetRef = useRef(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [mapError, setMapError] = useState(false);

  callbacksRef.current = { onMapClickCoordinates, onSelectCamera, onSelectRoute };
  dataRef.current = {
    cameras,
    recommendedRoute,
    alternativeRoutes,
    highlightedSegment,
    mapSelectionMode,
    showCameras,
    cameraFilter,
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("safepath.showCameras");
    if (saved !== null) {
      cameraPreferenceSetRef.current = true;
      const parsed = saved === "true";
      setInternalShowCameras(parsed);
      onToggleCameras?.(parsed);
    }
  }, [onToggleCameras]);

  useEffect(() => {
    if (recommendedRoute && !cameraPreferenceSetRef.current) {
      setInternalShowCameras(false);
      onToggleCameras?.(false);
    }
  }, [recommendedRoute?.route_id, onToggleCameras]);

  const handleToggleCameras = useCallback(() => {
    cameraPreferenceSetRef.current = true;
    const nextVal = !showCameras;
    setInternalShowCameras(nextVal);
    sessionStorage.setItem("safepath.showCameras", String(nextVal));
    onToggleCameras?.(nextVal);
  }, [showCameras, onToggleCameras]);

  const updateCameras = useCallback(() => {
    const map = mapRef.current;
    const { cameras: all, recommendedRoute: route, showCameras: visible, cameraFilter: filter } = dataRef.current;
    if (!map?.getSource("camera-source")) return;
    if (!visible || map.getZoom() < 10) {
      setSource(map, "camera-source", empty());
      if (containerRef.current) containerRef.current.dataset.cameraFeatureCount = "0";
      return;
    }
    const bounds = map.getBounds();
    const routeCoords = route?.geojson_path?.coordinates as number[][] | undefined;
    const inBounds = all.filter((cam) => Number.isFinite(cam.lng) && Number.isFinite(cam.lat) && bounds.contains([cam.lng, cam.lat]));

    const filtered = inBounds.filter((cam) => {
      if (filter === "ON_ROUTE") return cameraNearRoute(cam.lng, cam.lat, routeCoords);
      if (filter === "HAS_IMAGE") return Boolean(cam.has_image);
      return true;
    });

    const features: GeoJSON.Feature[] = filtered.map((cam) => {
      const onRoute = cameraNearRoute(cam.lng, cam.lat, routeCoords);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [cam.lng, cam.lat] },
        properties: {
          id: cam.cam_id,
          label: cam.code || "Camera",
          onRoute: onRoute ? 1 : 0,
          hasImage: cam.has_image ? 1 : 0,
        },
      };
    });
    setSource(map, "camera-source", { type: "FeatureCollection", features });
    if (containerRef.current) containerRef.current.dataset.cameraFeatureCount = String(features.length);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [106.7009, 10.7769],
      zoom: 13,
      attributionControl: false,
    });
    mapRef.current = map;
    if (typeof window !== "undefined") (window as any).__safepath_map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");

    const onStyleLoad = () => {
      setMapError(false);
      // Camera Layers - Refined luminous pearl / aurora style
      map.addSource("camera-source", {
        type: "geojson",
        data: empty(),
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 13,
      });
      map.addLayer({
        id: "camera-clusters",
        type: "circle",
        source: "camera-source",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#5E77F8",
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 2,
          "circle-radius": 16,
          "circle-opacity": 0.92,
        },
      });
      map.addLayer({
        id: "camera-count",
        type: "symbol",
        source: "camera-source",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 },
        paint: { "text-color": "#FFFFFF" },
      });
      map.addLayer({
        id: "camera-points",
        type: "circle",
        source: "camera-source",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "case",
            ["==", ["coalesce", ["get", "onRoute"], 0], 1],
            "#F59E0B",
            ["==", ["coalesce", ["get", "hasImage"], 0], 1],
            "#06B6D4",
            "#7C94FF",
          ],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 6],
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "camera-label",
        type: "symbol",
        source: "camera-source",
        filter: ["!", ["has", "point_count"]],
        minzoom: 14,
        layout: { "text-field": ["get", "label"], "text-size": 10, "text-offset": [0, 1.4], "text-optional": true },
        paint: { "text-color": "#15233D", "text-halo-color": "#FFFFFF", "text-halo-width": 2 },
      });

      // Route Layers
      map.addSource("route-alternatives-source", { type: "geojson", data: empty() });
      map.addLayer({
        id: "route-alternatives-line",
        type: "line",
        source: "route-alternatives-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#94A3B8", "line-width": 5, "line-opacity": 0.85, "line-dasharray": [2, 1] },
      });

      map.addSource("route-recommended-source", { type: "geojson", data: empty() });
      map.addLayer({
        id: "route-recommended-casing",
        type: "line",
        source: "route-recommended-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#15233D", "line-width": 11, "line-opacity": 0.95 },
      });
      map.addLayer({
        id: "route-recommended-core",
        type: "line",
        source: "route-recommended-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0284C7", "line-width": 6, "line-opacity": 1 },
      });

      map.addSource("route-step-source", { type: "geojson", data: empty() });
      map.addLayer({
        id: "route-step-highlight",
        type: "line",
        source: "route-step-source",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F59E0B", "line-width": 8, "line-opacity": 1 },
      });

      if (containerRef.current) {
        const ids = map.getStyle().layers.map((layer) => layer.id);
        containerRef.current.dataset.routeAboveCamera = String(
          ids.indexOf("route-recommended-core") > ids.indexOf("camera-points")
        );
      }
      setStyleVersion((v) => v + 1);
      updateCameras();
    };

    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (dataRef.current.mapSelectionMode === "NONE") return;
      callbacksRef.current.onMapClickCoordinates({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };

    const onCameraClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!dataRef.current.showCameras) return;
      const id = e.features?.[0]?.properties?.id;
      const camera = dataRef.current.cameras.find((c) => c.cam_id === id);
      if (camera) callbacksRef.current.onSelectCamera(camera);
    };

    const onRouteClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (dataRef.current.mapSelectionMode !== "NONE") return;
      const id = e.features?.[0]?.properties?.routeId;
      const route = dataRef.current.alternativeRoutes.find((r) => r.route_id === id);
      if (route) callbacksRef.current.onSelectRoute?.(route);
    };

    const onIdle = () => {
      if (map.areTilesLoaded() && containerRef.current) containerRef.current.dataset.tilesReady = "true";
    };

    const onMoveEnd = () => {
      updateCameras();
      if (containerRef.current) containerRef.current.dataset.mapZoom = map.getZoom().toFixed(3);
    };

    const setCursorPointer = () => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = "pointer"; };
    const resetCursor = () => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = ""; };

    const onClusterClick = (e: maplibregl.MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["camera-clusters"] });
      const clusterId = features[0]?.properties?.cluster_id;
      const source = map.getSource("camera-source") as maplibregl.GeoJSONSource | undefined;
      if (source && clusterId !== undefined) {
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          if (zoom === null || zoom === undefined) return;
          const coords = (features[0].geometry as GeoJSON.Point).coordinates;
          map.easeTo({ center: [coords[0], coords[1]], zoom: zoom + 1 });
        }).catch(() => {});
      }
    };

    map.on("style.load", onStyleLoad);
    map.on("click", onMapClick);
    map.on("click", "camera-points", onCameraClick);
    map.on("click", "camera-clusters", onClusterClick);
    map.on("mouseenter", "camera-points", setCursorPointer);
    map.on("mouseleave", "camera-points", resetCursor);
    map.on("mouseenter", "camera-clusters", setCursorPointer);
    map.on("mouseleave", "camera-clusters", resetCursor);
    map.on("click", "route-alternatives-line", onRouteClick);
    map.on("moveend", onMoveEnd);
    map.on("idle", onIdle);

    const timer = window.setTimeout(() => {
      if (!map.getSource("route-recommended-source")) setMapError(true);
    }, 15000);
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      markerRef.current.forEach((m) => m.remove());
      markerRef.current = [];
      map.off("style.load", onStyleLoad);
      map.off("click", onMapClick);
      map.off("click", "camera-points", onCameraClick);
      map.off("click", "camera-clusters", onClusterClick);
      map.off("mouseenter", "camera-points", setCursorPointer);
      map.off("mouseleave", "camera-points", resetCursor);
      map.off("mouseenter", "camera-clusters", setCursorPointer);
      map.off("mouseleave", "camera-clusters", resetCursor);
      map.off("click", "route-alternatives-line", onRouteClick);
      map.off("moveend", onMoveEnd);
      map.off("idle", onIdle);
      map.remove();
      mapRef.current = null;
      if (typeof window !== "undefined") delete (window as any).__safepath_map;
    };
  }, [updateCameras]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("route-recommended-source")) return;
    setSource(map, "route-recommended-source", {
      type: "FeatureCollection",
      features: recommendedRoute ? [lineFeature(recommendedRoute)] : [],
    });
    setSource(map, "route-alternatives-source", {
      type: "FeatureCollection",
      features: alternativeRoutes.map(lineFeature),
    });
    setSource(map, "route-step-source", {
      type: "FeatureCollection",
      features: highlightedSegment?.geojson_path
        ? [{ type: "Feature", properties: {}, geometry: highlightedSegment.geojson_path as GeoJSON.LineString }]
        : [],
    });

    if (containerRef.current) {
      if (recommendedRoute) {
        containerRef.current.dataset.routeVertices = String(recommendedRoute.geojson_path.coordinates.length);
        containerRef.current.dataset.selectedRouteId = recommendedRoute.route_id;
        const coordinates = recommendedRoute.geojson_path.coordinates as number[][];
        containerRef.current.dataset.routeGeometryKey = JSON.stringify([
          coordinates.length,
          coordinates[Math.floor(coordinates.length / 3)],
          coordinates[Math.floor((coordinates.length * 2) / 3)],
        ]);
      } else {
        delete containerRef.current.dataset.routeVertices;
        delete containerRef.current.dataset.selectedRouteId;
        delete containerRef.current.dataset.routeGeometryKey;
      }
      if (highlightedSegment?.geojson_path) {
        containerRef.current.dataset.highlightVertices = String(highlightedSegment.geojson_path.coordinates.length);
      } else {
        delete containerRef.current.dataset.highlightVertices;
      }
    }

    updateCameras();

    if (recommendedRoute?.route_id && lastFitRouteRef.current !== recommendedRoute.route_id) {
      const coords = recommendedRoute.geojson_path.coordinates as number[][];
      if (coords.length) {
        const bounds = coords.reduce((b, p) => b.extend([p[0], p[1]]), new maplibregl.LngLatBounds());
        map.resize();
        map.fitBounds(bounds, {
          padding: { top: 75, bottom: 75, left: 55, right: 55 },
          duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600,
          maxZoom: 15,
        });
        lastFitRouteRef.current = recommendedRoute.route_id;
      }
    }
    if (!recommendedRoute) lastFitRouteRef.current = null;
  }, [recommendedRoute, alternativeRoutes, highlightedSegment, styleVersion, updateCameras]);

  useEffect(() => {
    updateCameras();
  }, [cameras, showCameras, updateCameras, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current.forEach((m) => m.remove());
    markerRef.current = [];
    const add = (point: Coordinates | null | undefined, label: string, colorClass: string, type: string) => {
      if (!point) return;
      const el = document.createElement("div");
      el.className = `w-8 h-8 rounded-full border-2 border-white shadow-glass flex items-center justify-center text-white font-bold text-xs ${colorClass}`;
      el.textContent = label;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", type);
      el.dataset.markerType = type;
      markerRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map));
    };
    add(origin, "A", "bg-emerald-500", "origin");
    add(destination, "B", "bg-rose-500", "destination");
    add(currentLocation, "●", "bg-blue-600 ring-4 ring-blue-400/30", "current-location");
  }, [origin, destination, currentLocation]);

  useEffect(() => {
    if (currentLocation && mapRef.current && locationFocusToken > lastLocationFocusRef.current) {
      lastLocationFocusRef.current = locationFocusToken;
      mapRef.current.flyTo({
        center: [currentLocation.lng, currentLocation.lat],
        zoom: 16,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600,
      });
    }
  }, [currentLocation, locationFocusToken]);

  return (
    <div className="relative w-full h-full min-h-0 overflow-hidden bg-pearl-100">
      <div ref={containerRef} className="w-full h-full" aria-label="Bản đồ tuyến đường" data-testid="route-map" />

      {mapError && (
        <div role="alert" className="absolute bottom-12 left-3 z-20 rounded-2xl glass-panel-elevated p-3 text-sm text-ink-900 border border-rose-200">
          Không tải được bản đồ.{" "}
          <button className="underline text-indigo-600 font-semibold" onClick={() => window.location.reload()}>
            Thử lại
          </button>
        </div>
      )}

      {mapSelectionMode !== "NONE" && (
        <div className="absolute top-4 left-4 right-20 z-20 rounded-2xl glass-panel px-4 py-2.5 text-xs font-bold text-ink-900 pointer-events-none flex items-center gap-2 border border-amber-300 shadow-glass animate-float">
          <MapPin className="h-4 w-4 text-amber-500" />
          <span>{mapSelectionMode === "ORIGIN" ? "Chạm bản đồ để chọn điểm đi" : "Chạm bản đồ để chọn điểm đến"}</span>
        </div>
      )}

      {/* Floating Liquid Glass Controls: Floating Camera Toggle (No right-side "Vị trí của tôi" button) */}
      <div className="absolute top-3.5 right-14 z-10 flex items-center gap-2">
        <GlassToggle
          checked={showCameras}
          onChange={handleToggleCameras}
          label="Hiển thị camera"
          filter={cameraFilter}
          onFilterChange={(f) => {
            setCameraFilter(f);
            updateCameras();
          }}
          cameraCount={{
            active: cameras.filter((c) => Number.isFinite(c.lng) && Number.isFinite(c.lat)).length,
            total: cameras.length,
          }}
        />
      </div>
    </div>
  );
};
