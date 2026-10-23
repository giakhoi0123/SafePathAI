"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CameraEvidence, Coordinates, MapSelectionMode, RouteSegmentRisk, SafeRouteResponse } from "../types/contracts";
import { Camera, Crosshair, MapPin } from "lucide-react";

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
}

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const cameraNearRoute = (lng: number, lat: number, coords?: number[][]) => {
  if (!coords || coords.length < 2) return false;
  const scale = Math.cos(lat * Math.PI / 180);
  for (let i = 1; i < coords.length; i++) {
    const [aLng, aLat] = coords[i - 1];
    const [bLng, bLat] = coords[i];
    const dx = (bLng - aLng) * scale;
    const dy = bLat - aLat;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, (((lng - aLng) * scale) * dx + (lat - aLat) * dy) / length)) : 0;
    if (Math.hypot((lng - aLng) * scale - t * dx, lat - aLat - t * dy) < 0.0008) return true;
  }
  return false;
};
const lineFeature = (route: SafeRouteResponse): GeoJSON.Feature => ({
  type: "Feature", properties: { routeId: route.route_id }, geometry: route.geojson_path as GeoJSON.LineString,
});
const setSource = (map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) =>
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);

export const MapContainer: React.FC<MapContainerProps> = ({
  cameras, recommendedRoute, alternativeRoutes, highlightedSegment, origin, destination,
  currentLocation, locationFocusToken = 0, mapSelectionMode = "NONE", onMapClickCoordinates, onSelectCamera,
  onSelectRoute, onRequestCurrentLocation, isRequestingLocation,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const callbacksRef = useRef({ onMapClickCoordinates, onSelectCamera, onSelectRoute });
  const dataRef = useRef({ cameras, recommendedRoute, alternativeRoutes, highlightedSegment, mapSelectionMode, showCameras: true });
  const markerRef = useRef<maplibregl.Marker[]>([]);
  const lastLocationFocusRef = useRef(0);
  const lastFitRouteRef = useRef<string | null>(null);
  const cameraPreferenceSetRef = useRef(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [mapError, setMapError] = useState(false);
  const [showCameras, setShowCameras] = useState(true);
  callbacksRef.current = { onMapClickCoordinates, onSelectCamera, onSelectRoute };
  dataRef.current = { cameras, recommendedRoute, alternativeRoutes, highlightedSegment, mapSelectionMode, showCameras };

  useEffect(() => {
    const saved = sessionStorage.getItem("safepath.showCameras");
    if (saved !== null) {
      cameraPreferenceSetRef.current = true;
      setShowCameras(saved === "true");
    }
  }, []);
  useEffect(() => {
    if (recommendedRoute && !cameraPreferenceSetRef.current) setShowCameras(false);
  }, [recommendedRoute?.route_id]);

  const updateCameras = useCallback(() => {
    const map = mapRef.current;
    const { cameras: all, recommendedRoute: route, showCameras: visible } = dataRef.current;
    if (!map?.getSource("camera-source")) return;
    if (!visible || map.getZoom() < 10) {
      setSource(map, "camera-source", empty());
      if (containerRef.current) containerRef.current.dataset.cameraFeatureCount = "0";
      return;
    }
    const bounds = map.getBounds();
    const routeCoords = route?.geojson_path.coordinates as number[][] | undefined;
    const features: GeoJSON.Feature[] = all.filter((cam) =>
      Number.isFinite(cam.lng) && Number.isFinite(cam.lat) && bounds.contains([cam.lng, cam.lat])
    ).map((cam) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [cam.lng, cam.lat] },
      properties: { id: cam.cam_id, label: cam.code || "Camera", onRoute: cameraNearRoute(cam.lng, cam.lat, routeCoords) ? 1 : 0 },
    }));
    setSource(map, "camera-source", { type: "FeatureCollection", features });
    if (containerRef.current) containerRef.current.dataset.cameraFeatureCount = String(features.length);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current, style: "https://tiles.openfreemap.org/styles/liberty",
      center: [106.7009, 10.7769], zoom: 13, attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
    const onStyleLoad = () => {
      setMapError(false);
      map.addSource("camera-source", { type: "geojson", data: empty(), cluster: true, clusterRadius: 42, clusterMaxZoom: 13 });
      map.addLayer({ id: "camera-clusters", type: "circle", source: "camera-source", filter: ["has", "point_count"], paint: { "circle-color": "#334155", "circle-stroke-color": "#e2e8f0", "circle-stroke-width": 2, "circle-radius": 17 } });
      map.addLayer({ id: "camera-count", type: "symbol", source: "camera-source", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 }, paint: { "text-color": "#fff" } });
      map.addLayer({ id: "camera-points", type: "circle", source: "camera-source", filter: ["!", ["has", "point_count"]], paint: { "circle-color": ["case", ["==", ["get", "onRoute"], 1], "#f59e0b", "#64748b"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 7], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "camera-label", type: "symbol", source: "camera-source", filter: ["!", ["has", "point_count"]], minzoom: 14, layout: { "text-field": ["get", "label"], "text-size": 10, "text-offset": [0, 1.4], "text-optional": true }, paint: { "text-color": "#fff", "text-halo-color": "#0f172a", "text-halo-width": 2 } });
      map.addSource("route-alternatives-source", { type: "geojson", data: empty() });
      map.addLayer({ id: "route-alternatives-line", type: "line", source: "route-alternatives-source", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#475569", "line-width": 5, "line-opacity": 0.85, "line-dasharray": [2, 1] } });
      map.addSource("route-recommended-source", { type: "geojson", data: empty() });
      map.addLayer({ id: "route-recommended-casing", type: "line", source: "route-recommended-source", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0f172a", "line-width": 11, "line-opacity": 0.95 } });
      map.addLayer({ id: "route-recommended-core", type: "line", source: "route-recommended-source", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#38bdf8", "line-width": 6, "line-opacity": 1 } });
      map.addSource("route-step-source", { type: "geojson", data: empty() });
      map.addLayer({ id: "route-step-highlight", type: "line", source: "route-step-source", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fbbf24", "line-width": 8, "line-opacity": 1 } });
      if (containerRef.current) {
        const ids = map.getStyle().layers.map((layer) => layer.id);
        containerRef.current.dataset.routeAboveCamera = String(ids.indexOf("route-recommended-core") > ids.indexOf("camera-points"));
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
    const onIdle = () => { if (map.areTilesLoaded() && containerRef.current) containerRef.current.dataset.tilesReady = "true"; };
    const onMoveEnd = () => {
      updateCameras();
      if (containerRef.current) containerRef.current.dataset.mapZoom = map.getZoom().toFixed(3);
    };
    map.on("style.load", onStyleLoad);
    map.on("click", onMapClick);
    map.on("click", "camera-points", onCameraClick);
    map.on("click", "route-alternatives-line", onRouteClick);
    map.on("moveend", onMoveEnd);
    map.on("idle", onIdle);
    const timer = window.setTimeout(() => { if (!map.getSource("route-recommended-source")) setMapError(true); }, 15000);
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
      map.off("click", "route-alternatives-line", onRouteClick);
      map.off("moveend", onMoveEnd);
      map.off("idle", onIdle);
      map.remove();
      mapRef.current = null;
    };
  }, [updateCameras]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("route-recommended-source")) return;
    setSource(map, "route-recommended-source", { type: "FeatureCollection", features: recommendedRoute ? [lineFeature(recommendedRoute)] : [] });
    setSource(map, "route-alternatives-source", { type: "FeatureCollection", features: alternativeRoutes.map(lineFeature) });
    setSource(map, "route-step-source", { type: "FeatureCollection", features: highlightedSegment?.geojson_path ? [{ type: "Feature", properties: {}, geometry: highlightedSegment.geojson_path as GeoJSON.LineString }] : [] });
    if (containerRef.current) {
      if (recommendedRoute) {
        containerRef.current.dataset.routeVertices = String(recommendedRoute.geojson_path.coordinates.length);
        containerRef.current.dataset.selectedRouteId = recommendedRoute.route_id;
        const coordinates = recommendedRoute.geojson_path.coordinates as number[][];
        containerRef.current.dataset.routeGeometryKey = JSON.stringify([coordinates.length, coordinates[Math.floor(coordinates.length / 3)], coordinates[Math.floor(coordinates.length * 2 / 3)]]);
      }
      else { delete containerRef.current.dataset.routeVertices; delete containerRef.current.dataset.selectedRouteId; delete containerRef.current.dataset.routeGeometryKey; }
      if (highlightedSegment?.geojson_path) containerRef.current.dataset.highlightVertices = String(highlightedSegment.geojson_path.coordinates.length);
      else delete containerRef.current.dataset.highlightVertices;
    }
    updateCameras();
    if (recommendedRoute?.route_id && lastFitRouteRef.current !== recommendedRoute.route_id) {
      const coords = recommendedRoute.geojson_path.coordinates as number[][];
      if (coords.length) {
        const bounds = coords.reduce((b, p) => b.extend([p[0], p[1]]), new maplibregl.LngLatBounds());
        map.resize();
        map.fitBounds(bounds, { padding: { top: 65, bottom: 65, left: 45, right: 45 }, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600, maxZoom: 15 });
        lastFitRouteRef.current = recommendedRoute.route_id;
      }
    }
    if (!recommendedRoute) lastFitRouteRef.current = null;
  }, [recommendedRoute, alternativeRoutes, highlightedSegment, styleVersion, updateCameras]);

  useEffect(() => { updateCameras(); }, [cameras, showCameras, updateCameras, styleVersion]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current.forEach((m) => m.remove());
    markerRef.current = [];
    const add = (point: Coordinates | null | undefined, label: string, color: string, type: string) => {
      if (!point) return;
      const el = document.createElement("div");
      el.className = `w-8 h-8 rounded-full border-2 border-white shadow-xl flex items-center justify-center text-white font-bold text-xs ${color}`;
      el.textContent = label;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", type);
      el.dataset.markerType = type;
      markerRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map));
    };
    add(origin, "A", "bg-emerald-600", "origin");
    add(destination, "B", "bg-rose-600", "destination");
    add(currentLocation, "●", "bg-blue-600", "current-location");
  }, [origin, destination, currentLocation]);
  useEffect(() => {
    if (currentLocation && mapRef.current && locationFocusToken > lastLocationFocusRef.current) {
      lastLocationFocusRef.current = locationFocusToken;
      mapRef.current.flyTo({ center: [currentLocation.lng, currentLocation.lat], zoom: 16, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600 });
    }
  }, [currentLocation, locationFocusToken]);

  return <div className="relative w-full h-full min-h-0 overflow-hidden bg-slate-950" data-testid="route-map">
    <div ref={containerRef} className="w-full h-full" aria-label="Bản đồ tuyến đường" />
    {mapError && <div role="alert" className="absolute bottom-12 left-3 z-20 rounded-lg bg-slate-900 p-3 text-sm text-white">Không tải được bản đồ. <button className="underline" onClick={() => window.location.reload()}>Thử lại</button></div>}
    {mapSelectionMode !== "NONE" && <div className="absolute top-3 left-3 right-16 z-20 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 pointer-events-none flex gap-2"><MapPin className="h-4 w-4" />{mapSelectionMode === "ORIGIN" ? "Chạm bản đồ để chọn điểm đi" : "Chạm bản đồ để chọn điểm đến"}</div>}
    <div className="absolute top-24 right-2 z-10 flex flex-row gap-2 md:flex-col">
      {onRequestCurrentLocation && <button type="button" onClick={onRequestCurrentLocation} disabled={isRequestingLocation} className="rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-white shadow-lg disabled:opacity-50" aria-label="Vị trí của tôi" title="Vị trí của tôi"><Crosshair className="h-5 w-5" /></button>}
      <button type="button" role="switch" aria-checked={showCameras} onClick={() => { cameraPreferenceSetRef.current = true; setShowCameras((v) => { sessionStorage.setItem("safepath.showCameras", String(!v)); return !v; }); }} className={`flex min-h-11 items-center gap-2 rounded-lg border p-2.5 text-xs font-semibold text-white shadow-lg ${showCameras ? "border-sky-400 bg-sky-800" : "border-slate-600 bg-slate-900"}`} aria-label="Hiển thị camera" title="Hiển thị camera"><Camera className="h-5 w-5" /><span className="hidden sm:inline">Hiển thị camera</span><span>{showCameras ? "Bật" : "Tắt"}</span></button>
    </div>
  </div>;
};
