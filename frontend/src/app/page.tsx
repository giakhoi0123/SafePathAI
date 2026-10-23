"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  CameraEvidence,
  Coordinates,
  RiskLevel,
  SafeRouteResponse,
  WeatherTideSignal,
  WebSocketAlertMessage,
} from "../types/contracts";
import {
  connectAlertsWebSocket,
  fetchCameras,
  fetchHealth,
  fetchWeatherTide,
  searchSafeRoute,
} from "../services/api";
import { MapContainer } from "../components/MapContainer";
import { CameraEvidenceModal } from "../components/CameraEvidenceModal";
import { VoiceHUD } from "../components/VoiceHUD";
import {
  Navigation,
  MapPin,
  ArrowRightLeft,
  Search,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Radio,
  Clock,
  Layers,
  Info,
  CheckCircle,
  CloudRain,
  Waves,
} from "lucide-react";

const HCMC_PRESETS: { name: string; coords: Coordinates }[] = [
  { name: "Chợ Bến Thành (Quận 1)", coords: { lat: 10.7725, lng: 106.6980 } },
  { name: "Landmark 81 (Bình Thạnh)", coords: { lat: 10.7950, lng: 106.7218 } },
  { name: "Ngã tư Hàng Xanh (Bình Thạnh)", coords: { lat: 10.8012, lng: 106.7115 } },
  { name: "Đường Nguyễn Hữu Cảnh", coords: { lat: 10.7981, lng: 106.7186 } },
  { name: "Sân bay Tân Sơn Nhất", coords: { lat: 10.8185, lng: 106.6588 } },
  { name: "Nhà thờ Đức Bà (Quận 1)", coords: { lat: 10.7798, lng: 106.6990 } },
];

const coverageLabel = (status?: string) => ({
  NO_VERIFIED_OBSERVATIONS: "Có vị trí camera, chưa có quan trắc xác minh",
  NO_CAMERAS_IN_CORRIDOR: "Không có camera trong hành lang",
  NO_VERIFIED_CAMERA_GPS: "Chưa có camera với GPS xác minh",
  SPATIALLY_NEAR_UNVERIFIED_VIEW: "Camera gần tuyến; chưa xác minh hướng nhìn",
  CORRIDOR_DATA_UNAVAILABLE: "Dữ liệu hành lang chưa khả dụng",
  UNAVAILABLE: "Chưa có dữ liệu",
}[status || "UNAVAILABLE"] || "Chưa có dữ liệu");

const renderRiskBadge = (risk: RiskLevel) => {
  switch (risk) {
    case RiskLevel.CRITICAL:
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>NGUY KỊCH (CRITICAL)</span>
        </span>
      );
    case RiskLevel.MODERATE:
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>RỦI RO VỪA (MODERATE)</span>
        </span>
      );
    case RiskLevel.SAFE:
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
          <CheckCircle className="w-3.5 h-3.5" />
          <span>AN TOÀN (SAFE)</span>
        </span>
      );
    case RiskLevel.INSUFFICIENT_EVIDENCE:
    case RiskLevel.UNKNOWN:
    default:
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
          <Info className="w-3.5 h-3.5 text-blue-400" />
          <span>CHƯA XÁC MINH (UNKNOWN)</span>
        </span>
      );
  }
};

export default function SafePathDashboard() {
  const [cameras, setCameras] = useState<CameraEvidence[]>([]);
  const [origin, setOrigin] = useState<Coordinates>(HCMC_PRESETS[0].coords);
  const [destination, setDestination] = useState<Coordinates>(HCMC_PRESETS[2].coords);
  const [recommendedRoute, setRecommendedRoute] = useState<SafeRouteResponse | null>(null);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [alternativeRoutes, setAlternativeRoutes] = useState<SafeRouteResponse[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraEvidence | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [latestAlertMessage, setLatestAlertMessage] = useState<string | null>(null);
  const [backendHealth, setBackendHealth] = useState<string>("checking");
  const [weatherTide, setWeatherTide] = useState<WeatherTideSignal | null>(null);

  // Load cameras, health & weather on initial mount
  const refreshCameras = useCallback(async () => {
    try {
      const data = await fetchCameras();
      setCameras(data);
    } catch (e) {
      console.warn("Could not fetch cameras:", e);
    }
  }, []);

  const refreshWeatherTide = useCallback(async () => {
    try {
      const wt = await fetchWeatherTide();
      setWeatherTide(wt);
    } catch (e) {
      console.warn("Could not fetch weather/tide:", e);
    }
  }, []);

  useEffect(() => {
    refreshCameras();
    refreshWeatherTide();
    fetchHealth().then((h) => setBackendHealth(h.status || "offline"));

    // Connect to WebSocket alerts with deduplication and exponential backoff
    const disconnectWs = connectAlertsWebSocket(
      (msg: WebSocketAlertMessage) => {
        if (msg.type === "CRITICAL_FLOOD_ALERT") {
          setLatestAlertMessage(msg.message);
          refreshCameras();
          refreshWeatherTide();
        } else if (msg.type === "FLOOD_ALL_CLEAR") {
          setLatestAlertMessage(msg.message);
          refreshCameras();
          refreshWeatherTide();
        }
      },
      (connected) => setWsConnected(connected)
    );

    return () => {
      disconnectWs();
    };
  }, [refreshCameras, refreshWeatherTide]);

  // Execute safe route search
  const handleSearchRoute = useCallback(
    async (orig: Coordinates = origin, dest: Coordinates = destination) => {
      const requestId = ++requestSequenceRef.current;
      setIsLoadingRoute(true);
      setRouteError(null);
      setRecommendedRoute(null);
      setSelectedStepIndex(null);
      setAlternativeRoutes([]);
      try {
        const routeData = await searchSafeRoute(orig, dest);
        if (requestId !== requestSequenceRef.current) return;
        setRecommendedRoute(routeData);
        setAlternativeRoutes(routeData.alternative_routes || []);
      } catch (err) {
        if (requestId === requestSequenceRef.current) {
          setRouteError(err instanceof Error ? err.message : "Không thể tìm tuyến đường.");
        }
      } finally {
        if (requestId === requestSequenceRef.current) setIsLoadingRoute(false);
      }
    },
    [origin, destination]
  );

  // Trigger initial search once on mount
  useEffect(() => {
    handleSearchRoute();
  }, []);

  // Handle map click picking A and B
  const [clickCount, setClickCount] = useState<number>(0);
  const handleMapClick = (coords: Coordinates) => {
    if (clickCount % 2 === 0) {
      requestSequenceRef.current++;
      setOrigin(coords);
      setIsLoadingRoute(false);
      setRecommendedRoute(null);
      setAlternativeRoutes([]);
      setClickCount((c) => c + 1);
    } else {
      setDestination(coords);
      setClickCount((c) => c + 1);
      handleSearchRoute(origin, coords);
    }
  };

  // Swap Origin and Destination
  const handleSwap = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
    handleSearchRoute(destination, temp);
  };

  // Count verified cameras with active live evidence (Zero-Mock strictly enforces real status)
  const verifiedActiveCamerasCount = cameras.filter(
    (c) => c.source_status === "LIVE" && c.spatial_match_status === "OBSERVED_SEGMENT_VERIFIED" && c.risk_level !== RiskLevel.UNKNOWN
  ).length;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-5 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl shadow-lg shadow-blue-500/20 text-white">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black tracking-tight text-white">
                SafePath<span className="text-blue-400">AI</span>
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                TP. Hồ Chí Minh
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5">
              Định tuyến ô tô theo dữ liệu OSM thực • Đánh giá rủi ro từ bằng chứng xác minh
            </p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-3">
          {/* Verified Cameras Counter Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-slate-800/80 border border-slate-700/60 rounded-lg text-xs font-medium text-slate-300">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>{verifiedActiveCamerasCount} camera đủ xác minh</span>
            <span className="text-[10px] text-slate-500 font-mono">({cameras.length} đăng ký)</span>
          </div>

          {/* WebSocket Live Indicator */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
              wsConnected
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400"
            }`}
          >
            <Radio className={`w-3 h-3 ${wsConnected ? "animate-pulse" : ""}`} />
            <span>{wsConnected ? "WebSocket Trực Tiếp" : "Đang Kết Nối Lại..."}</span>
          </div>
        </div>
      </header>

      {/* Main App Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Control Sidebar */}
        <aside className="w-full sm:w-[460px] h-full flex flex-col border-r border-slate-800 bg-slate-900/95 backdrop-blur-md z-20 overflow-y-auto shrink-0 shadow-2xl">
          <div className="p-4 space-y-4">
            {/* Environmental Conditions Widget (Weather & Tide) */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-2.5 shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <CloudRain className="w-3.5 h-3.5 text-blue-400" />
                  Môi trường & Thủy văn Thực địa
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {weatherTide?.timestamp ? new Date(weatherTide.timestamp).toLocaleTimeString("vi-VN") : "Đang kết nối"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {/* Weather Rainfall */}
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5 space-y-1">
                  <span className="text-[10px] text-slate-400 block">Lượng mưa (Open-Meteo)</span>
                  <div className="font-bold text-sm text-white">
                    {weatherTide?.rain_mm_per_hour !== null && weatherTide?.rain_mm_per_hour !== undefined
                      ? `${weatherTide.rain_mm_per_hour.toFixed(1)} mm/h`
                      : "Chưa có dữ liệu"}
                  </div>
                  <span className="text-[10px] text-slate-500 block">
                    Trạng thái: <strong>{weatherTide?.rain_status || "UNAVAILABLE"}</strong>
                  </span>
                </div>

                {/* Tide Water Level */}
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5 space-y-1">
                  <span className="text-[10px] text-slate-400 block flex items-center gap-1">
                    <Waves className="w-3 h-3 text-cyan-400" />
                    Thủy triều (Trạm Phú An)
                  </span>
                  <div className="font-bold text-sm text-white">
                    {weatherTide?.tide_level_meters !== null && weatherTide?.tide_level_meters !== undefined
                      ? `${weatherTide.tide_level_meters.toFixed(2)} m`
                      : "Chưa có bản tin"}
                  </div>
                  <span className="text-[10px] text-slate-500 block">
                    Hệ mốc: <strong>Hòn Dấu (VN-2000)</strong>
                  </span>
                </div>
              </div>

              {weatherTide?.is_high_tide_alert && (
                <div className="p-2 bg-rose-950/60 border border-rose-500/40 rounded-xl text-[11px] text-rose-300 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Cảnh báo triều cường: Mực nước vượt ngưỡng Báo động II (&ge; 1.50m)</span>
                </div>
              )}
            </div>

            {/* Origin & Destination Route Search Form */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Kế Hoạch Lộ Trình
                </span>
                <button
                  onClick={handleSwap}
                  className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
                  title="Đảo chiều điểm đi và điểm đến"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </button>
              </div>

              {/* Origin Selection */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Điểm Xuất Phát (A)
                </label>
                <select
                  value={`${origin.lat},${origin.lng}`}
                  onChange={(e) => {
                    const [lat, lng] = e.target.value.split(",").map(Number);
                    setOrigin({ lat, lng });
                    requestSequenceRef.current++;
                    setIsLoadingRoute(false);
                    setRecommendedRoute(null);
                    setAlternativeRoutes([]);
                  }}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {HCMC_PRESETS.map((p) => (
                    <option key={p.name} value={`${p.coords.lat},${p.coords.lng}`}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Destination Selection */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-rose-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Điểm Đến (B)
                </label>
                <select
                  value={`${destination.lat},${destination.lng}`}
                  onChange={(e) => {
                    const [lat, lng] = e.target.value.split(",").map(Number);
                    setDestination({ lat, lng });
                    requestSequenceRef.current++;
                    setIsLoadingRoute(false);
                    setRecommendedRoute(null);
                    setAlternativeRoutes([]);
                  }}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {HCMC_PRESETS.map((p) => (
                    <option key={p.name} value={`${p.coords.lat},${p.coords.lng}`}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Button */}
              <button
                onClick={() => handleSearchRoute()}
                disabled={isLoadingRoute}
                className="w-full mt-2 py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition"
              >
                {isLoadingRoute ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span>Tìm tuyến đường OSM</span>
              </button>
              {routeError && (
                <div role="alert" className="rounded-lg border border-rose-500/50 bg-rose-950/40 p-3 text-xs text-rose-200">
                  <p>Không có tuyến để hiển thị: {routeError}</p>
                  <button type="button" className="mt-2 underline" onClick={() => handleSearchRoute()}>Thử lại</button>
                </div>
              )}
            </div>

            {/* Voice HUD & AI Explanation Card */}
            <VoiceHUD
              explanation={recommendedRoute?.ai_explanation || ""}
              overallRisk={recommendedRoute?.overall_risk || RiskLevel.UNKNOWN}
              latestAlert={latestAlertMessage}
            />

            {/* Candidate Route Results */}
            {recommendedRoute && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Các tuyến OSRM và độ phủ dữ liệu
                </h3>

                {/* Primary Recommended Route (#1) */}
                <div className="bg-slate-900 border-2 border-blue-500/50 rounded-2xl p-4 space-y-3 shadow-lg relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-blue-500 text-white font-black text-[10px] uppercase px-3 py-0.5 rounded-bl-lg tracking-wider">
                    Tuyến đang chọn
                  </div>

                  <div className="flex items-center justify-between pr-20">
                    <div>
                      <div className="text-xl font-black text-white">
                        {recommendedRoute.estimated_time_mins.toFixed(0)}{" "}
                        <span className="text-xs font-normal text-slate-400">phút</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Khoảng cách: <strong>{recommendedRoute.total_distance_km.toFixed(1)} km</strong>
                      </div>
                      {recommendedRoute.ranking_cost && (
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          Chi phí xếp hạng rủi ro: {recommendedRoute.ranking_cost.toFixed(1)}
                        </div>
                      )}
                    </div>

                    <div>
                      {renderRiskBadge(recommendedRoute.overall_risk)}
                    </div>
                  </div>
                  <p className="text-xs text-slate-300">{recommendedRoute.ai_explanation} Hành lang: {coverageLabel(recommendedRoute.evidence_coverage)}.</p>

                  {/* Route Segments & Evidence Cameras */}
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <span className="text-[11px] font-semibold text-slate-300">
                      Bước dẫn đường OSRM & dữ liệu đường OSM:
                    </span>
                    <div className="space-y-1.5">
                      {recommendedRoute.segments.map((seg, idx) => (
                        <div
                          key={idx}
                          className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-xs flex items-center justify-between"
                        >
                          <div>
                            <span className="font-semibold text-white">
                              {seg.street_name || "Đoạn đường đô thị"}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-1.5">
                              ({(seg.length_meters / 1000).toFixed(1)} km)
                            </span>
                            <span className="block text-[10px] text-slate-400">{coverageLabel(seg.evidence_coverage)}</span>
                            <span className="block text-[10px] text-slate-500">
                              {seg.osm_way_id && seg.osm_edge_index ? `OSM Way ${seg.osm_way_id}, cạnh ${seg.osm_edge_index} đã xác minh` :
                                `${seg.candidate_road_edges?.length || 0} cạnh OSM ứng viên; ID đoạn chưa xác minh`}
                            </span>
                            {seg.geojson_path && (
                              <button type="button" className="text-[10px] text-amber-300 underline mt-1"
                                onClick={() => setSelectedStepIndex(selectedStepIndex === idx ? null : idx)}>
                                {selectedStepIndex === idx ? "Ẩn đoạn trên bản đồ" : "Xem đoạn trên bản đồ"}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            {seg.evidence_cameras.map((c) => (
                              <button
                                key={c.cam_id}
                                onClick={() => setSelectedCamera(c)}
                                className="px-1.5 py-0.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-[10px] rounded font-mono font-bold transition flex items-center gap-1"
                                title="Xem ảnh phân tích camera"
                              >
                                <span>📹</span>
                                <span>{c.code || "CAM"}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Alternative Routes */}
                {alternativeRoutes.map((alt, altIdx) => (
                  <div
                    key={alt.route_id || altIdx}
                    className="bg-slate-950/80 border border-slate-700/50 rounded-2xl p-4 space-y-2 text-xs text-slate-300 opacity-80 hover:opacity-100 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-white">
                          Tuyến ứng viên #{altIdx + 1}
                        </span>
                        <div className="text-[11px] text-slate-400">
                          {alt.total_distance_km.toFixed(1)} km • OSRM ước tính:{" "}
                          <strong className="text-blue-400">
                            {alt.estimated_time_mins.toFixed(0)} phút
                          </strong>
                        </div>
                      </div>

                      <div>
                        {renderRiskBadge(alt.overall_risk)}
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-300/80 italic">
                      {alt.ai_explanation} {coverageLabel(alt.evidence_coverage)}.
                    </p>
                    <button
                      type="button"
                      className="underline text-blue-300 hover:text-blue-200 font-semibold"
                      onClick={() => {
                        setRecommendedRoute(alt);
                        setSelectedStepIndex(null);
                        setAlternativeRoutes([
                          recommendedRoute,
                          ...alternativeRoutes.filter((c) => c.route_id !== alt.route_id),
                        ]);
                      }}
                    >
                      Chọn tuyến này
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Right Main Map Container */}
        <main className="flex-1 h-full relative">
          <MapContainer
            cameras={cameras}
            recommendedRoute={recommendedRoute}
            alternativeRoutes={alternativeRoutes}
            highlightedSegment={selectedStepIndex === null ? null : recommendedRoute?.segments[selectedStepIndex]}
            origin={origin}
            destination={destination}
            onMapClickCoordinates={handleMapClick}
            onSelectCamera={(cam) => setSelectedCamera(cam)}
          />
        </main>
      </div>

      {/* Camera Evidence Modal */}
      <CameraEvidenceModal
        camera={selectedCamera}
        onClose={() => setSelectedCamera(null)}
      />
    </div>
  );
}
