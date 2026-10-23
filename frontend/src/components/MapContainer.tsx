"use client";

import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer } from "@deck.gl/layers";
import { CameraEvidence, Coordinates, RiskLevel, RouteSegmentRisk, SafeRouteResponse } from "../types/contracts";
import { MapPin, Navigation, Info, Eye } from "lucide-react";

interface MapContainerProps {
  cameras: CameraEvidence[];
  recommendedRoute: SafeRouteResponse | null;
  alternativeRoutes: SafeRouteResponse[];
  highlightedSegment?: RouteSegmentRisk | null;
  origin: Coordinates | null;
  destination: Coordinates | null;
  onMapClickCoordinates: (coords: Coordinates) => void;
  onSelectCamera: (camera: CameraEvidence) => void;
}

export const MapContainer: React.FC<MapContainerProps> = ({
  cameras,
  recommendedRoute,
  alternativeRoutes,
  highlightedSegment,
  origin,
  destination,
  onMapClickCoordinates,
  onSelectCamera,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onMapClickRef = useRef(onMapClickCoordinates);
  onMapClickRef.current = onMapClickCoordinates;
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [mapLoaded, setMapLoaded] = useState<boolean>(false);
  const [hoveredCamera, setHoveredCamera] = useState<CameraEvidence | null>(null);
  const [mapError, setMapError] = useState(false);

  // Initialize MapLibre GL map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [106.7009, 10.7769], // Ho Chi Minh City center
      zoom: 13,
      pitch: 0,
      bearing: 0,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    // Initialize Deck.gl MapboxOverlay
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });
    map.addControl(overlay as unknown as maplibregl.IControl);
    deckOverlayRef.current = overlay;

    // Click handler for setting origin / destination
    map.on("click", (e) => {
      onMapClickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.on("error", () => setMapError(true));
    map.on("idle", () => {
      if (map.areTilesLoaded() && mapContainerRef.current) {
        mapContainerRef.current.dataset.tilesReady = "true";
      }
    });

    map.on("style.load", () => {
      // 1. Source for recommended route
      map.addSource("route-recommended-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      // Outer glow/casing layer
      map.addLayer({
        id: "route-recommended-glow",
        type: "line",
        source: "route-recommended-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#3B82F6",
          "line-width": 10,
          "line-opacity": 0.35,
          "line-blur": 3,
        },
      });

      // Core line layer
      map.addLayer({
        id: "route-recommended-core",
        type: "line",
        source: "route-recommended-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#3B82F6",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });

      // 2. Source for alternative routes
      map.addSource("route-alternatives-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "route-alternatives-line",
        type: "line",
        source: "route-alternatives-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#64748B",
          "line-width": 4,
          "line-dasharray": [2, 2],
          "line-opacity": 0.6,
        },
      });

      map.addSource("route-step-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-step-highlight",
        type: "line",
        source: "route-step-source",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#FBBF24", "line-width": 8, "line-opacity": 0.95 },
      });

      map.moveLayer("route-recommended-glow");
      map.moveLayer("route-recommended-core");
      map.moveLayer("route-step-highlight");

      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Route Polylines when routes change
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;

    // Update Recommended Route
    const recSource = map.getSource("route-recommended-source") as maplibregl.GeoJSONSource | undefined;
    if (recSource) {
      if (recommendedRoute && recommendedRoute.geojson_path) {
        recSource.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                risk: recommendedRoute.overall_risk,
              },
              geometry: recommendedRoute.geojson_path as any,
            },
          ],
        });
        if (mapContainerRef.current) {
          mapContainerRef.current.dataset.routeVertices = String(recommendedRoute.geojson_path.coordinates.length);
        }

        // Set route color according to risk
        let color = "#3B82F6"; // route found; risk unknown
        if (recommendedRoute.overall_risk === RiskLevel.SAFE) color = "#10B981";
        if (recommendedRoute.overall_risk === RiskLevel.MODERATE) color = "#F59E0B";
        if (recommendedRoute.overall_risk === RiskLevel.CRITICAL) color = "#EF4444";

        map.setPaintProperty("route-recommended-core", "line-color", color);
        map.setPaintProperty("route-recommended-glow", "line-color", color);
      } else {
        recSource.setData({ type: "FeatureCollection", features: [] });
        if (mapContainerRef.current) delete mapContainerRef.current.dataset.routeVertices;
      }
    }

    // Update Alternative Routes
    const altSource = map.getSource("route-alternatives-source") as maplibregl.GeoJSONSource | undefined;
    if (altSource) {
      if (alternativeRoutes && alternativeRoutes.length > 0) {
        const altFeatures = alternativeRoutes.map((alt) => ({
          type: "Feature" as const,
          properties: {
            risk: alt.overall_risk,
          },
          geometry: alt.geojson_path as any,
        }));
        altSource.setData({
          type: "FeatureCollection",
          features: altFeatures,
        });
      } else {
        altSource.setData({ type: "FeatureCollection", features: [] });
      }
    }

    // Auto-fit bounds if recommended route is present
    if (recommendedRoute && recommendedRoute.geojson_path && recommendedRoute.geojson_path.coordinates) {
      const coords = recommendedRoute.geojson_path.coordinates as number[][];
      if (coords.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach(([lng, lat]) => bounds.extend([lng, lat]));
        if (mapContainerRef.current) delete mapContainerRef.current.dataset.tilesReady;
        map.fitBounds(bounds, { padding: 80, duration: 1000, maxZoom: 15 });
      }
    }
  }, [recommendedRoute, alternativeRoutes, mapLoaded]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource("route-step-source") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: highlightedSegment?.geojson_path ? [{
        type: "Feature", properties: {}, geometry: highlightedSegment.geojson_path,
      }] : [],
    });
    if (mapContainerRef.current) {
      if (highlightedSegment?.geojson_path) {
        mapContainerRef.current.dataset.highlightVertices = String(highlightedSegment.geojson_path.coordinates.length);
      } else {
        delete mapContainerRef.current.dataset.highlightVertices;
      }
    }
  }, [highlightedSegment, mapLoaded]);

  // Update Deck.gl 3D Flood & Traffic Layers
  useEffect(() => {
    if (!deckOverlayRef.current) return;
    const observedCameras = cameras.filter((c) => c.source_status === "LIVE" && c.risk_level !== RiskLevel.UNKNOWN);
    if (observedCameras.length === 0) {
      deckOverlayRef.current.setProps({ layers: [] });
      return;
    }

    // Deck.gl ColumnLayer: Visualizes verified observation points without fake skyscraper elevation
    const floodColumns = new ColumnLayer<CameraEvidence>({
      id: "camera-flood-columns-3d",
      data: observedCameras,
      diskResolution: 16,
      radius: 35,
      extruded: false, // Flat ground disc: Zero-Mock rule prohibits fake tall towers from 2D flood ratios
      pickable: true,
      getPosition: (d: CameraEvidence) => [d.lng, d.lat],
      getFillColor: (d: CameraEvidence) => {
        if (d.flood_ratio >= 0.35) {
          return [239, 68, 68, 220]; // Red Critical Flood
        }
        if (d.flood_ratio > 0.0) {
          return [59, 130, 246, 200]; // Blue Water Puddle
        }
        if (d.traffic_density_score > 0.6) {
          return [245, 158, 11, 180]; // Orange Congested
        }
        return [100, 116, 139, 150];
      },
      onHover: (info) => {
        setHoveredCamera((info.object as CameraEvidence) || null);
      },
      onClick: (info) => {
        if (info.object) {
          onSelectCamera(info.object as CameraEvidence);
        }
      },
    });

    deckOverlayRef.current.setProps({
      layers: [floodColumns],
    });
  }, [cameras, onSelectCamera]);

  // Update HTML Markers for Origin, Destination, and Cameras
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Clear previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Origin Marker (A - Emerald)
    if (origin) {
      const el = document.createElement("div");
      el.className =
        "w-8 h-8 rounded-full bg-emerald-500 border-2 border-white shadow-xl flex items-center justify-center text-white font-black text-xs cursor-pointer hover:scale-110 transition";
      el.innerText = "A";
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map);
      markersRef.current.push(m);
    }

    // Destination Marker (B - Rose)
    if (destination) {
      const el = document.createElement("div");
      el.className =
        "w-8 h-8 rounded-full bg-rose-500 border-2 border-white shadow-xl flex items-center justify-center text-white font-black text-xs cursor-pointer hover:scale-110 transition";
      el.innerText = "B";
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([destination.lng, destination.lat])
        .addTo(map);
      markersRef.current.push(m);
    }

    // Camera Label Markers
    cameras.forEach((cam) => {
      const el = document.createElement("div");
      const isCritical = cam.risk_level === RiskLevel.CRITICAL || cam.flood_ratio >= 0.35;
      const isModerate = cam.risk_level === RiskLevel.MODERATE;

      const bgClass = isCritical
        ? "bg-rose-600 text-white animate-bounce shadow-rose-900/50"
        : isModerate
        ? "bg-amber-500 text-slate-900"
        : "bg-slate-800 text-slate-200";

      el.className = `px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shadow-md cursor-pointer border border-slate-600/60 hover:scale-125 transition select-none flex items-center gap-1 ${bgClass}`;
      el.textContent = `📹 ${cam.code || "CAM"}`;

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectCamera(cam);
      });

      const m = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([cam.lng, cam.lat])
        .addTo(map);
      markersRef.current.push(m);
    });
  }, [origin, destination, cameras, onSelectCamera]);

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
      {/* MapLibre Canvas Container */}
      <div ref={mapContainerRef} className="w-full h-full" />
      {mapError && (
        <div role="alert" className="absolute bottom-4 right-4 z-20 rounded bg-slate-900 p-3 text-xs text-white">
          Không tải được bản đồ. <button className="underline" onClick={() => window.location.reload()}>Thử lại</button>
        </div>
      )}

      {/* Floating Map Legend & Status Overlay */}
      <div className="absolute top-4 left-4 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-3 shadow-xl text-xs space-y-2 pointer-events-auto max-w-xs">
        <div className="flex items-center justify-between font-bold text-slate-200 border-b border-slate-800 pb-1.5">
          <span className="flex items-center gap-1.5 text-blue-400">
            <Navigation className="w-4 h-4" />
            Bản đồ tuyến đường SafePathAI
          </span>
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
            Deck.gl 3D
          </span>
        </div>

        {/* Legend entries */}
        <div className="space-y-1 text-slate-300 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500 shadow-sm" />
            <span>Tuyến đã tìm thấy; rủi ro chưa xác minh</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-1 bg-slate-500 rounded border-dashed" />
            <span>Tuyến ứng viên khác từ OSRM</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-blue-500" />
            <span>Điểm quan trắc xác minh (nếu có)</span>
          </div>
        </div>

        <div className="pt-1 text-[10px] text-slate-400 border-t border-slate-800 flex items-center gap-1">
          <Info className="w-3 h-3 text-slate-500 shrink-0" />
          <span>Click bản đồ để chọn Điểm A & Điểm B</span>
        </div>
      </div>

      {/* Hovered Camera Tooltip */}
      {hoveredCamera && (
        <div className="absolute bottom-4 left-4 z-10 bg-slate-900/95 border border-slate-700/80 rounded-xl p-3 shadow-2xl text-xs text-white max-w-xs pointer-events-none animate-fadeIn">
          <div className="flex items-center gap-2 font-bold text-blue-400">
            <Eye className="w-3.5 h-3.5" />
            <span>{hoveredCamera.code || "CAM"} - {hoveredCamera.name}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {hoveredCamera.district || "TP.HCM"}
          </p>
          <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800 text-[11px]">
            <div>
              Ngập nước:{" "}
              <strong className={hoveredCamera.flood_ratio >= 0.35 ? "text-rose-400" : "text-blue-400"}>
                {Math.round(hoveredCamera.flood_ratio * 100)}%
              </strong>
            </div>
            <div>
              Xe quan trắc: <strong>{hoveredCamera.vehicle_count} xe</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

