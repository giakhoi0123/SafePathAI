"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CameraEvidence } from "../../types/contracts";

interface CitySceneProps {
  cameras: CameraEvidence[];
  camera: CameraEvidence | null;
  scene: number;
}

// Representative transport corridor across Saigon River (Thủ Thiêm -> Bến Thành)
const CORRIDOR_FEATURE: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: { name: "Hành lang kết nối trung tâm" },
  geometry: {
    type: "LineString",
    coordinates: [
      [106.7235, 10.7997], // Cầu Sài Gòn
      [106.7118, 10.8016], // Hàng Xanh
      [106.7056, 10.7672], // Hầm Thủ Thiêm
      [106.6980, 10.7720], // Bến Thành / Lê Lợi
      [106.6811, 10.7787], // Dân Chủ
    ],
  },
};

export function CityScene({ cameras, camera, scene }: CitySceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // 1. Initialize MapLibre with 3D Extrusions & Light Pearl Material
  useEffect(() => {
    if (!container.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
        center: [106.7009, 10.7769],
        zoom: 12.8,
        pitch: 48,
        bearing: -12,
        interactive: false,
        attributionControl: false,
      });
    } catch {
      setFailed(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      // 1.1 Add 3D building extrusion layer if building vector layer exists
      const layers = map.getStyle().layers || [];
      const labelLayer = layers.find(
        (l) => l.type === "symbol" && l.layout && (l.layout as any)["text-field"]
      );

      // Attempt adding 3D extruded buildings from Carto / OpenMapTiles source
      const cartoSource = map.getSource("carto") || map.getSource("openmaptiles");
      if (cartoSource && !map.getLayer("3d-buildings-pearl")) {
        try {
          const sourceId = map.getSource("carto") ? "carto" : "openmaptiles";
          map.addLayer(
            {
              id: "3d-buildings-pearl",
              source: sourceId,
              "source-layer": "building",
              type: "fill-extrusion",
              minzoom: 13,
              paint: {
                "fill-extrusion-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "render_height"],
                  0, "#F5FAFF",
                  30, "#EBF3FE",
                  80, "#DCEBFC",
                  150, "#D0E4FA",
                ],
                "fill-extrusion-height": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  13, 0,
                  15, ["coalesce", ["get", "render_height"], ["get", "height"], 22],
                ],
                "fill-extrusion-base": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  13, 0,
                  15, ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
                ],
                "fill-extrusion-opacity": 0.82,
              },
            },
            labelLayer ? labelLayer.id : undefined
          );
        } catch (e) {
          console.debug("3D building extrusion skipped:", e);
        }
      }

      // 1.2 Add glowing corridor route line
      map.addSource("ethereal-corridor", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [CORRIDOR_FEATURE],
        },
      });

      map.addLayer({
        id: "corridor-glow",
        source: "ethereal-corridor",
        type: "line",
        paint: {
          "line-color": "#7C94FF",
          "line-width": 8,
          "line-opacity": 0.28,
          "line-blur": 6,
        },
      });

      map.addLayer({
        id: "corridor-core",
        source: "ethereal-corridor",
        type: "line",
        paint: {
          "line-color": "#67DCE5",
          "line-width": 2.5,
          "line-opacity": 0.85,
        },
      });

      // 1.3 Add verified camera registry points
      map.addSource("observed-registry", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Halo glow
      map.addLayer({
        id: "registry-cameras-glow",
        source: "observed-registry",
        type: "circle",
        paint: {
          "circle-radius": 8,
          "circle-color": "#7C94FF",
          "circle-opacity": 0.35,
          "circle-blur": 0.8,
        },
      });

      // Core camera beacon
      map.addLayer({
        id: "registry-cameras",
        source: "observed-registry",
        type: "circle",
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#4F46E5",
          "circle-opacity": 0.95,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });

      setReady(true);
      setFailed(false);
    });

    const timeout = setTimeout(() => {
      if (!map.loaded()) setFailed(true);
    }, 15000);

    return () => {
      clearTimeout(timeout);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Update real camera GeoJSON data
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource("observed-registry") as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: cameras
        .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
        .map((c) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [c.lng, c.lat] },
          properties: { cam_id: c.cam_id },
        })),
    });
  }, [cameras, ready]);

  // 3. Multi-scene Cinematic Camera Motions
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const isReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = isReduced ? 0 : 1400;

    // Cinematic angle configurations for each chapter
    if (scene === 0) {
      // Scene 0: City Panorama (isometric wide angle)
      mapRef.current.easeTo({
        center: [106.7009, 10.7769],
        zoom: 12.8,
        pitch: 48,
        bearing: -12,
        duration,
      });
    } else if (scene === 1) {
      // Scene 1: Camera Network & AI Vision (glides into active hub)
      const targetCenter = camera ? [camera.lng, camera.lat] : [106.6980, 10.7720];
      mapRef.current.easeTo({
        center: targetCenter as [number, number],
        zoom: camera ? 15.2 : 14.2,
        pitch: 58,
        bearing: 18,
        duration,
      });
    } else if (scene === 2) {
      // Scene 2: Environmental & Tide Water (Saigon river perspective)
      mapRef.current.easeTo({
        center: [106.7110, 10.7890],
        zoom: 13.6,
        pitch: 42,
        bearing: -28,
        duration,
      });
    } else if (scene === 3) {
      // Scene 3: Navigation Corridor (elevated forward view)
      mapRef.current.easeTo({
        center: [106.6960, 10.7730],
        zoom: 14.8,
        pitch: 54,
        bearing: 8,
        duration,
      });
    }
  }, [camera, scene, ready]);

  // 4. Subtle Mouse Move Parallax (Deep 3D Experience)
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const isReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (isReduced) return;

    let rafId: number;
    const handleMouseMove = (e: MouseEvent) => {
      if (!mapRef.current) return;
      const { innerWidth, innerHeight } = window;
      const offsetX = (e.clientX / innerWidth - 0.5) * 2; // -1 to 1
      const offsetY = (e.clientY / innerHeight - 0.5) * 2; // -1 to 1

      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!mapRef.current) return;
        const currentPitch = mapRef.current.getPitch();
        const currentBearing = mapRef.current.getBearing();
        // Subtle +/- 1.5 deg tilt without jarring transitions
        mapRef.current.setPitch(Math.max(20, Math.min(65, currentPitch - offsetY * 0.08)));
        mapRef.current.setBearing(currentBearing + offsetX * 0.08);
      });
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, [ready]);

  // 5. Floating Pearl Aurora Particles Canvas Overlay
  useEffect(() => {
    const canvas = particleCanvasRef.current;
    if (!canvas) return;
    const isReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (isReduced) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    // 20 soft floating ambient light orbs
    const particles = Array.from({ length: 22 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 4 + 2,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      alpha: Math.random() * 0.35 + 0.15,
      color: Math.random() > 0.5 ? "124, 148, 255" : "103, 220, 229", // Aurora Blue & Cyan
    }));

    let animId: number;
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.shadowColor = `rgba(${p.color}, 0.5)`;
        ctx.shadowBlur = 8;
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div className="observatory-map relative overflow-hidden pointer-events-none select-none">
      {/* MapLibre 3D WebGL Canvas */}
      <div ref={container} className="observatory-map-canvas w-full h-full" />

      {/* Floating Pearl Aurora Particle Overlay */}
      <canvas
        ref={particleCanvasRef}
        className="absolute inset-0 pointer-events-none z-10 opacity-70"
        aria-hidden="true"
      />

      {/* Ethereal Vignette Fog (Atmospheric Liquid Glass Depth) */}
      <div
        className="absolute inset-0 pointer-events-none z-20 bg-gradient-to-t from-white/75 via-transparent to-white/40"
        aria-hidden="true"
      />

      {failed && (
        <span className="map-unavailable" role="status">
          Không tải được bản đồ nền. Dữ liệu quan trắc hiển thị riêng bên trên.
        </span>
      )}
    </div>
  );
}
