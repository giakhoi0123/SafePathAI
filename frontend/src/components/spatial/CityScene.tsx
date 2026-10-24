"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CameraEvidence } from "../../types/contracts";

/** Geographic context from real OSM tiles and registry coordinates. No invented roads or routes. */
export function CityScene({ cameras, camera, scene }: { cameras: CameraEvidence[]; camera: CameraEvidence | null; scene: number }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [106.7009, 10.7769], zoom: 12, pitch: 40,
        interactive: false, attributionControl: false,
      });
    } catch { setFailed(true); return; }
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => {
      map.addSource("observed-registry", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "registry-cameras", source: "observed-registry", type: "circle", paint: { "circle-radius": 3, "circle-color": "#9cb7c6", "circle-opacity": .75, "circle-stroke-width": 1, "circle-stroke-color": "#182b3b" } });
      setReady(true); setFailed(false);
    });
    const timeout = setTimeout(() => { if (!map.loaded()) setFailed(true); }, 15000);
    return () => { clearTimeout(timeout); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource("observed-registry") as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: cameras.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map(c => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { cam_id: c.cam_id } })) });
  }, [cameras, ready]);
  useEffect(() => {
    if (!ready) return;
    const focus = scene === 1 && camera;
    mapRef.current?.easeTo({ center: focus ? [camera.lng, camera.lat] : [106.7009, 10.7769], zoom: focus ? 15 : 12, pitch: focus ? 60 : 40, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 });
  }, [camera, scene, ready]);
  return <div className="observatory-map"><div ref={container} className="observatory-map-canvas"/>{failed && <span className="map-unavailable" role="status">Không tải được bản đồ nền. Dữ liệu quan trắc hiển thị riêng bên trên.</span>}</div>;
}
