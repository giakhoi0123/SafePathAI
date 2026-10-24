"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  CameraEvidence,
  Coordinates,
  MapSelectionMode,
  NavigationUXState,
  PlaceResult,
  RiskLevel,
  SafeRouteResponse,
  WebSocketAlertMessage,
} from "../types/contracts";
import {
  connectAlertsWebSocket,
  reverseGeocode,
  searchSafeRoute,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useLiveObservations } from "../hooks/useLiveObservations";
import { cameraObservationStatus, currentRain, currentTide, hasVerifiedFloodObservation } from "../lib/observations";
import { isVerifiedRouteAlert } from "../lib/navigation";
import { VoiceHUD } from "./VoiceHUD";
import { MapContainer } from "./MapContainer";
import { CameraEvidenceModal } from "./CameraEvidenceModal";
import { NavigationGuidance } from "./NavigationGuidance";
import { RouteResults } from "./RouteResults";
import { PlaceSearchCombobox } from "./PlaceSearchCombobox";
import { OnboardingHelpButton } from "./onboarding/OnboardingHelpButton";
import {
  Navigation,
  Home,
  Box,
  ArrowRightLeft,
  Search,
  ShieldAlert,
  AlertTriangle,
  Radio,
  Layers,
  Info,
  CheckCircle,
  CloudRain,
  Waves,
  Sun,
  Cloud,
  User,
} from "lucide-react";

const HCMC_PRESETS: { name: string; coords: Coordinates }[] = [
  { name: "Chợ Bến Thành (Quận 1)", coords: { lat: 10.7725, lng: 106.6980 } },
  { name: "Landmark 81 (Bình Thạnh)", coords: { lat: 10.7950, lng: 106.7218 } },
  { name: "Ngã tư Hàng Xanh (Bình Thạnh)", coords: { lat: 10.8012, lng: 106.7115 } },
  { name: "Đường Nguyễn Hữu Cảnh", coords: { lat: 10.7981, lng: 106.7186 } },
  { name: "Sân bay Tân Sơn Nhất", coords: { lat: 10.8185, lng: 106.6588 } },
  { name: "Thảo Điền", coords: { lat: 10.8034, lng: 106.7322 } },
  { name: "Phú Mỹ Hưng (Quận 7)", coords: { lat: 10.729, lng: 106.722 } },
  { name: "Nhà thờ Đức Bà (Quận 1)", coords: { lat: 10.7798, lng: 106.6990 } },
];

export default function SafePathDashboard() {
  const { user, addRouteHistory } = useAuth();
  const [pitch3D, setPitch3D] = useState(true);
  const [showFlood, setShowFlood] = useState(false);
  const live = useLiveObservations();
  const { cameras, weather: weatherTide } = live;
  const rain = currentRain(weatherTide, live.now);
  const tide = currentTide(weatherTide, live.now);
  const [, setUxState] = useState<NavigationUXState>("IDLE");
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [originText, setOriginText] = useState<string>("");
  const [destination, setDestination] = useState<Coordinates | null>(null);
  const [destinationText, setDestinationText] = useState<string>("");
  const [selectedOriginPlace, setSelectedOriginPlace] = useState<PlaceResult | null>(null);
  const [selectedDestinationPlace, setSelectedDestinationPlace] = useState<PlaceResult | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locationFocusToken, setLocationFocusToken] = useState(0);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mapSelectionMode, setMapSelectionMode] = useState<MapSelectionMode>("NONE");

  const [recommendedRoute, setRecommendedRoute] = useState<SafeRouteResponse | null>(null);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [alternativeRoutes, setAlternativeRoutes] = useState<SafeRouteResponse[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraEvidence | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const routeResultsRef = useRef<HTMLDivElement>(null);
  const shouldScrollResultsRef = useRef(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [latestAlertMessage, setLatestAlertMessage] = useState<WebSocketAlertMessage | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("origin");
    if (!value) return;
    const [lat, lng] = value.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 10 || lat > 12 || lng < 106 || lng > 108) return;
    setOrigin({lat, lng});
    setOriginText(`Địa điểm đã lưu [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
  }, []);

  useEffect(() => {
    return connectAlertsWebSocket((message: WebSocketAlertMessage) => {
      if (message.type === "CRITICAL_FLOOD_ALERT" && message.source.startsWith("camera_vision:")) {
        setLatestAlertMessage(message);
      }
    }, setWsConnected);
  }, []);

  // Execute safe route search
  const handleSearchRoute = useCallback(
    async (orig: Coordinates | null = origin, dest: Coordinates | null = destination) => {
      if (!orig || !dest) {
        setRouteError("Vui lòng chọn cả điểm xuất phát và điểm đến hợp lệ.");
        return;
      }
      const requestId = ++requestSequenceRef.current;
      setIsLoadingRoute(true);
      setRouteError(null);
      setRecommendedRoute(null);
      setSelectedStepIndex(null);
      setAlternativeRoutes([]);
      setUxState("ROUTING");

      try {
        const routeData = await searchSafeRoute(orig, dest);
        if (requestId !== requestSequenceRef.current) return;
        const routes = [routeData, ...(routeData.alternative_routes || [])];
        const fastest = routes.reduce((best, route) =>
          route.estimated_time_mins < best.estimated_time_mins ? route : best
        );
        shouldScrollResultsRef.current = true;
        setRecommendedRoute(fastest);
        setSelectedCamera(fastest.segments.flatMap(segment => segment.evidence_cameras).find(camera => camera.has_image) ?? null);
        setAlternativeRoutes(routes.filter((route) => route.route_id !== fastest.route_id));
        setSheetExpanded(true);
        setUxState("ROUTE_FOUND");
        if (addRouteHistory) {
          addRouteHistory({
            originName: selectedOriginPlace?.name || originText || "Điểm xuất phát",
            destName: selectedDestinationPlace?.name || destinationText || "Điểm đến",
            distanceKm: parseFloat(fastest.total_distance_km.toFixed(1)),
            durationMins: Math.round(fastest.estimated_time_mins),
            originLat: orig.lat, originLng: orig.lng, destLat: dest.lat, destLng: dest.lng,
          });
        }
      } catch (err: any) {
        if (requestId === requestSequenceRef.current) {
          const errMsg = err instanceof Error ? err.message : "Không thể tìm tuyến đường.";
          if (errMsg.includes("PROVIDER_DOWN") || errMsg.includes("ROUTING_PROVIDER_UNAVAILABLE")) {
            setRouteError("Dịch vụ tìm đường đang gián đoạn. Vui lòng thử lại.");
            setUxState("PROVIDER_DOWN");
          } else {
            setRouteError(
              errMsg.includes("NO_ROUTE_FOUND")
                ? "Không tìm được tuyến lái xe hợp lệ giữa hai điểm."
                : errMsg
            );
            setUxState("NO_ROUTE");
          }
        }
      } finally {
        if (requestId === requestSequenceRef.current) setIsLoadingRoute(false);
      }
    },
    [origin, destination, originText, destinationText, selectedOriginPlace, selectedDestinationPlace, addRouteHistory]
  );

  useEffect(() => {
    if (!recommendedRoute || !shouldScrollResultsRef.current) return;
    shouldScrollResultsRef.current = false;
    routeResultsRef.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [recommendedRoute]);

  const invalidateRoute = useCallback(() => {
    requestSequenceRef.current++;
    setRecommendedRoute(null);
    setAlternativeRoutes([]);
    setSelectedStepIndex(null);
    setIsLoadingRoute(false);
    setRouteError(null);
  }, []);

  // Browser Geolocation ("Vị trí của tôi")
  const handleGetCurrentLocation = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setLocationError("Trình duyệt không hỗ trợ định vị GPS.");
      return;
    }

    setIsLocating(true);
    setLocationError(null);
    setUxState("LOCATION_REQUESTING");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const userCoords = { lat: latitude, lng: longitude };
        setCurrentLocation({ lat: latitude, lng: longitude, accuracy });
        setLocationFocusToken((value) => value + 1);
        invalidateRoute();
        setOrigin(userCoords);
        setIsLocating(false);

        // Reverse geocode user location
        try {
          const rev = await reverseGeocode(latitude, longitude);
          const nameStr = rev.name || rev.display_name;
          setOriginText(`Vị trí của bạn (${nameStr})`);
          setSelectedOriginPlace(rev);
        } catch {
          setOriginText(`Vị trí của bạn [${latitude.toFixed(4)}, ${longitude.toFixed(4)}]`);
        }

        if (destination) {
          setUxState("READY_TO_ROUTE");
        } else {
          setUxState("IDLE");
        }
      },
      (err) => {
        setIsLocating(false);
        setUxState("IDLE");
        if (err.code === 1) {
          setLocationError("Bạn đã từ chối cấp quyền vị trí. Vui lòng cho phép trong cài đặt trình duyệt.");
        } else if (err.code === 2) {
          setLocationError("Không thể xác định vị trí hiện tại của thiết bị.");
        } else if (err.code === 3) {
          setLocationError("Quá thời gian lấy vị trí GPS (timeout).");
        } else {
          setLocationError(`Lỗi định vị: ${err.message}`);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, [destination, invalidateRoute]);

  // Mode-aware Map Click Handler
  const handleMapClick = useCallback(
    async (coords: Coordinates) => {
      invalidateRoute();

      if (mapSelectionMode === "ORIGIN") {
        setOrigin(coords);
        setOriginText(`Đang xác định địa chỉ...`);
        setMapSelectionMode("NONE");
        try {
          const rev = await reverseGeocode(coords.lat, coords.lng);
          setOriginText(rev.name || rev.display_name);
          setSelectedOriginPlace(rev);
        } catch {
          setOriginText(`Vị trí đã chọn [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}]`);
        }
        if (destination) setUxState("READY_TO_ROUTE");
      } else if (mapSelectionMode === "DESTINATION") {
        setDestination(coords);
        setDestinationText(`Đang xác định địa chỉ...`);
        setMapSelectionMode("NONE");
        try {
          const rev = await reverseGeocode(coords.lat, coords.lng);
          setDestinationText(rev.name || rev.display_name);
          setSelectedDestinationPlace(rev);
        } catch {
          setDestinationText(`Vị trí đã chọn [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}]`);
        }
        if (origin) setUxState("READY_TO_ROUTE");
      } else {
        if (!origin) {
          setOrigin(coords);
          setOriginText(`Vị trí đã chọn [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}]`);
          reverseGeocode(coords.lat, coords.lng)
            .then((rev) => {
              setOriginText(rev.name || rev.display_name);
              setSelectedOriginPlace(rev);
            })
            .catch(() => {});
        } else {
          setDestination(coords);
          setDestinationText(`Vị trí đã chọn [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}]`);
          reverseGeocode(coords.lat, coords.lng)
            .then((rev) => {
              setDestinationText(rev.name || rev.display_name);
              setSelectedDestinationPlace(rev);
            })
            .catch(() => {});
          setUxState("READY_TO_ROUTE");
        }
      }
    },
    [mapSelectionMode, origin, destination, invalidateRoute]
  );

  // Swap Origin and Destination
  const handleSwap = () => {
    const tempCoords = origin;
    const tempText = originText;
    const tempPlace = selectedOriginPlace;

    setOrigin(destination);
    setOriginText(destinationText);
    setSelectedOriginPlace(selectedDestinationPlace);

    setDestination(tempCoords);
    setDestinationText(tempText);
    setSelectedDestinationPlace(tempPlace);

    if (destination && tempCoords && recommendedRoute) {
      handleSearchRoute(destination, tempCoords);
    }
  };

  const handleSelectRoute = useCallback(
    (route: SafeRouteResponse) => {
      if (!recommendedRoute || recommendedRoute.route_id === route.route_id) return;
      setAlternativeRoutes([
        recommendedRoute,
        ...alternativeRoutes.filter((item) => item.route_id !== route.route_id),
      ]);
      setRecommendedRoute(route);
      setSelectedCamera(route.segments.flatMap(segment => segment.evidence_cameras).find(camera => camera.has_image) ?? null);
      setSelectedStepIndex(null);
    },
    [recommendedRoute, alternativeRoutes]
  );

  const verifiedActiveCamerasCount = cameras.filter(c => hasVerifiedFloodObservation(c, live.now)).length;

  const selectedRouteExplanation = recommendedRoute
    ? (() => {
        const routes = [recommendedRoute, ...alternativeRoutes];
        const fastest = routes.reduce((best, route) =>
          route.estimated_time_mins < best.estimated_time_mins ? route : best
        );
        const name =
          recommendedRoute.route_id === fastest.route_id ? "Đường đề xuất theo thời gian" : "Đường đang chọn";
        const metrics = `${recommendedRoute.estimated_time_mins.toFixed(1)} phút, ${recommendedRoute.total_distance_km.toFixed(1)} km`;
        const allUnknown =
          !recommendedRoute.segments.length ||
          recommendedRoute.segments.every(
            (segment) =>
              segment.risk_level === RiskLevel.UNKNOWN ||
              segment.risk_level === RiskLevel.INSUFFICIENT_EVIDENCE
          );
        return allUnknown
          ? `${name}: ${metrics}. Chưa đủ dữ liệu để xác nhận mức rủi ro trên toàn tuyến.`
          : `${name}: ${metrics}. ${recommendedRoute.ai_explanation}`;
      })()
    : "";

  return (
    <div className="spatial-dashboard flex flex-col h-[100dvh] w-screen overflow-hidden bg-pearl-100 text-ink-900 relative">
      {/* Background ambient glowing aurora orbs */}
      <div className="absolute top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-gradient-to-br from-indigo-200/40 via-ice-200/30 to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-tl from-lavender-200/40 via-soft-cyan/30 to-transparent blur-3xl pointer-events-none" />

      {/* Top Floating Glass Navigation Bar */}
      <header className="h-14 glass-panel border-b border-white/80 px-4 md:px-6 flex items-center justify-between shrink-0 z-30 shadow-glass-sm">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="p-2 bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 rounded-2xl shadow-md shadow-indigo-500/25 text-white group-hover:scale-105 transition-transform">
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-ink-950">
                  SafePath<span className="aurora-gradient-text font-black">AI</span>
                </h1>
                <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/70 shadow-sm">
                  3.1
                </span>
              </div>
              <p className="hidden xl:block text-[11px] text-ink-500 leading-none mt-0.5 font-medium">
                Định tuyến thông minh · Camera thực tế · Thời tiết
              </p>
            </div>
          </Link>

          {/* Quick Page Links */}
          <nav className="hidden md:flex items-center gap-1.5 ml-2">
            <span className="px-3 py-1.5 rounded-full text-xs font-bold text-indigo-700 bg-white/90 border border-indigo-200/80 shadow-glass-sm">
              Bản đồ
            </span>
            <Link
              href="/monitor"
              className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-indigo-600 hover:bg-white/70 transition cursor-pointer"
            >
              Quan trắc Camera
            </Link>
            <Link
              href="/news"
              data-tour="nav-news-link"
              className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-indigo-600 hover:bg-white/70 transition cursor-pointer"
            >
              Bản tin giao thông
            </Link>
            <Link
              href="/dashboard"
              className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-indigo-600 hover:bg-white/70 transition cursor-pointer"
            >
              Bảng điều khiển
            </Link>
          </nav>
        </div>

        {/* Status Indicators & User Profile */}
        <div className="flex items-center gap-2.5">
          {/* Onboarding Help Button */}
          <OnboardingHelpButton variant="pill" />

          {/* Verified Cameras Counter Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 glass-pill rounded-full text-xs font-semibold text-ink-700 border border-white/90">
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            <span>{live.loading || live.errors.includes("camera") ? "—" : verifiedActiveCamerasCount} camera đủ xác minh</span>
            <span className="text-[10px] text-ink-400 font-mono">({live.summary?.total_registered ?? "—"} đăng ký)</span>
          </div>

          {/* WebSocket Live Indicator */}
          <div
            className={`hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
              wsConnected
                ? "bg-emerald-50/90 border-emerald-200 text-emerald-700"
                : "bg-amber-50/90 border-amber-200 text-amber-700"
            }`}
          >
            <Radio className={`w-3 h-3 ${wsConnected ? "animate-pulse" : ""}`} />
            <span>{wsConnected ? "Kênh cảnh báo đã kết nối" : "Kênh cảnh báo mất kết nối"}</span>
          </div>

          {/* User Account / Settings Link */}
          <Link
            href="/account"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white border border-white/90 shadow-glass-sm transition text-xs font-bold text-ink-800 cursor-pointer"
            title="Tài khoản và Cấu hình xe"
          >
            {user ? (
              <>
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-5 h-5 rounded-full border border-indigo-200 object-cover"
                  />
                ) : (
                  <User className="w-4 h-4 text-indigo-600" />
                )}
                <span className="hidden sm:inline max-w-[90px] truncate">{user.name}</span>
              </>
            ) : (
              <>
                <User className="w-4 h-4 text-indigo-600" />
                <span className="hidden sm:inline">Tài khoản</span>
              </>
            )}
          </Link>
        </div>
      </header>

      <VoiceHUD weather={weatherTide} now={live.now} cameraCount={live.loading || live.errors.includes("camera") ? null : cameras.filter(c => cameraObservationStatus(c, live.now) === "LIVE").length} explanation={selectedRouteExplanation} alert={latestAlertMessage && recommendedRoute && isVerifiedRouteAlert(latestAlertMessage, recommendedRoute, live.now) ? latestAlertMessage.message : undefined} />
      {live.errors.length > 0 && <div className="dashboard-data-error liquid-island" role="alert">Không tải được {live.errors.join(", ")}. <button onClick={live.refresh}>Thử lại</button></div>}
      {/* Main App Workspace */}
      <div className="dashboard-workspace flex flex-1 min-h-0 overflow-hidden relative">
        {/* Left Control Sidebar / Bottom Sheet */}
        <aside
          className={`floating-navigator absolute bottom-0 left-0 right-0 z-20 flex flex-col overflow-y-auto rounded-t-3xl border-t border-white/90 glass-panel-elevated shadow-glass-elevated transition-[height] duration-200 md:static md:h-full md:w-[420px] md:shrink-0 md:rounded-none md:border-r md:border-t-0 ${
            sheetExpanded ? "h-[min(55dvh,580px)]" : "h-[min(37dvh,280px)]"
          }`}
        >
          <button
            type="button"
            className="sticky top-0 z-30 flex min-h-10 items-center justify-center bg-white/60 backdrop-blur-md text-xs font-semibold text-ink-600 md:hidden"
            aria-label={sheetExpanded ? "Thu gọn bảng tuyến đường" : "Mở bảng tuyến đường"}
            aria-expanded={sheetExpanded}
            onClick={() => setSheetExpanded((v) => !v)}
          >
            <span className="h-1.5 w-12 rounded-full bg-slate-300" />
          </button>

          <div className="p-4 space-y-4">
            {/* Origin & Destination Route Search Form */}
            <div className="glass-panel rounded-3xl p-4 space-y-3.5 border border-white/90 shadow-glass">
              <div className="flex items-center justify-between border-b border-slate-200/70 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink-800 uppercase tracking-wider">
                    Kế hoạch chuyến đi
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSwap}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-ink-500 hover:text-ink-900 transition cursor-pointer"
                  title="Đảo chiều điểm đi và điểm đến"
                  aria-label="Đảo chiều lộ trình"
                >
                  <ArrowRightLeft className="w-4 h-4 text-indigo-600" />
                </button>
              </div>

              {/* Geolocation Error Alert if any */}
              {locationError && (
                <div
                  role="alert"
                  className="rounded-2xl border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-900 flex items-start gap-2 shadow-sm"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 leading-relaxed">{locationError}</div>
                  <button
                    type="button"
                    onClick={() => setLocationError(null)}
                    className="text-amber-700 hover:text-amber-950 font-bold text-xs"
                  >
                    Đóng
                  </button>
                </div>
              )}

              {/* Origin Selection Combobox */}
              <PlaceSearchCombobox
                label="Bạn đi từ đâu?"
                placeholder="Nhập địa chỉ, tên đường hoặc tọa độ..."
                color="emerald"
                value={originText}
                onChangeText={(t) => {
                  invalidateRoute();
                  setOriginText(t);
                  setOrigin(null);
                }}
                selectedCoordinates={origin}
                onSelectPlace={(p) => {
                  if (p) {
                    setOrigin({ lat: p.lat, lng: p.lng });
                    setSelectedOriginPlace(p);
                    if (destination) setUxState("READY_TO_ROUTE");
                  } else {
                    setOrigin(null);
                    setSelectedOriginPlace(null);
                  }
                }}
                onLocateMe={handleGetCurrentLocation}
                isLocating={isLocating}
                isPickingOnMap={mapSelectionMode === "ORIGIN"}
                onTogglePickOnMap={() =>
                  setMapSelectionMode((m) => (m === "ORIGIN" ? "NONE" : "ORIGIN"))
                }
                ariaLabel="Từ đâu? Điểm xuất phát"
                testId="origin-combobox"
              />

              {/* Destination Selection Combobox */}
              <PlaceSearchCombobox
                label="Bạn muốn đến đâu?"
                placeholder="Nhập địa chỉ, tên đường hoặc tọa độ..."
                color="rose"
                value={destinationText}
                onChangeText={(t) => {
                  invalidateRoute();
                  setDestinationText(t);
                  setDestination(null);
                }}
                selectedCoordinates={destination}
                onSelectPlace={(p) => {
                  if (p) {
                    setDestination({ lat: p.lat, lng: p.lng });
                    setSelectedDestinationPlace(p);
                    if (origin) setUxState("READY_TO_ROUTE");
                  } else {
                    setDestination(null);
                    setSelectedDestinationPlace(null);
                  }
                }}
                isPickingOnMap={mapSelectionMode === "DESTINATION"}
                onTogglePickOnMap={() =>
                  setMapSelectionMode((m) => (m === "DESTINATION" ? "NONE" : "DESTINATION"))
                }
                ariaLabel="Đến đâu? Điểm đến"
                testId="destination-combobox"
              />

              {/* Quick Presets Chips */}
              <div className="pt-2.5 border-t border-slate-200/80">
                <span className="text-[11px] text-ink-700 block mb-2 font-bold uppercase tracking-wider">
                  Địa điểm gợi ý nhanh tại TP.HCM:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {HCMC_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => {
                        invalidateRoute();
                        if (!origin) {
                          setOrigin(p.coords);
                          setOriginText(p.name);
                        } else {
                          setDestination(p.coords);
                          setDestinationText(p.name);
                          setUxState("READY_TO_ROUTE");
                        }
                      }}
                      className="px-3 py-1.5 rounded-full bg-white/85 hover:bg-white border border-indigo-100 hover:border-indigo-300 text-[11px] font-semibold text-ink-800 hover:text-indigo-700 shadow-glass-sm hover:shadow-glass hover:-translate-y-0.5 active:scale-98 transition-all duration-200 cursor-pointer"
                    >
                      {p.name.split(" (")[0]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Button */}
              <button
                type="button"
                data-tour="search-route-btn"
                onClick={() => handleSearchRoute()}
                disabled={isLoadingRoute || !origin || !destination}
                className="aurora-btn-primary w-full mt-3 py-3.5 px-4 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-xs rounded-2xl flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                {isLoadingRoute ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span>
                  {!origin || !destination
                    ? "Vui lòng chọn Điểm đi và Điểm đến"
                    : "Tìm tuyến đường"}
                </span>
              </button>

              {routeError && (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-300 bg-rose-50/90 p-3 text-xs text-rose-800 shadow-sm"
                >
                  <p className="font-medium">Không có tuyến để hiển thị: {routeError}</p>
                  <button
                    type="button"
                    className="mt-2 underline font-semibold text-rose-900 cursor-pointer"
                    onClick={() => handleSearchRoute()}
                  >
                    Thử lại
                  </button>
                </div>
              )}
            </div>

            <div data-tour="nav-guidance" className="space-y-3.5">
              {recommendedRoute ? (
                <div ref={routeResultsRef} className="space-y-3.5 scroll-mt-3">
                  <NavigationGuidance
                    route={recommendedRoute}
                    explanation={selectedRouteExplanation}
                    latestAlert={latestAlertMessage}
                    onPositionUpdate={setCurrentLocation}
                  />
                  <RouteResults
                    selected={recommendedRoute}
                    alternatives={alternativeRoutes}
                    selectedStepIndex={selectedStepIndex}
                    onSelect={handleSelectRoute}
                    onSelectStep={setSelectedStepIndex}
                    onSelectCamera={setSelectedCamera}
                  />
                </div>
              ) : (
                <NavigationGuidance
                  route={null}
                  explanation=""
                  latestAlert={latestAlertMessage}
                  onPositionUpdate={setCurrentLocation}
                />
              )}
            </div>

            {/* Environmental Conditions Widget (Weather & Tide) */}
            <div className="glass-panel rounded-3xl p-3.5 space-y-2.5 border border-white/90 shadow-glass">
              <div className="flex items-center justify-between border-b border-slate-200/70 pb-2">
                <span className="text-[11px] font-bold text-ink-800 uppercase tracking-wider flex items-center gap-1.5">
                  {weatherTide?.rain_mm_per_hour && weatherTide.rain_mm_per_hour > 0 ? (
                    <CloudRain className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                  ) : weatherTide?.weather_code === 0 || weatherTide?.weather_code === 1 ? (
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5 text-indigo-500" />
                  )}
                  Thời tiết & Thủy văn Thực địa
                </span>
                <span className="text-[10px] text-ink-400 font-mono">
                  {weatherTide?.timestamp
                    ? (() => {
                        const date = new Date(weatherTide.timestamp);
                        const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
                        return mins < 60 ? `Cập nhật ${mins} phút trước` : date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
                      })()
                    : "Đang kết nối"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {/* Weather Rainfall */}
                <div className="bg-gradient-to-br from-white/95 to-ice-50/70 border border-indigo-100/80 rounded-2xl p-3 space-y-1 shadow-glass-sm">
                  <span className="text-[10px] text-ink-600 block font-bold uppercase tracking-wider">Lượng mưa (Open-Meteo)</span>
                  <div className="font-black text-sm text-ink-950">
                    {rain !== null ? (
                      rain === 0 ? (
                        <span>0.0 mm/h <span className="text-[10px] font-semibold text-emerald-600 block">(Không mưa)</span></span>
                      ) : (
                        <span>{rain.toFixed(1)} mm/h <span className="text-[10px] font-semibold text-blue-600 block">(Có mưa)</span></span>
                      )
                    ) : (
                      "Chưa có dữ liệu"
                    )}
                  </div>
                  <span className="text-[10px] text-ink-500 block font-medium">
                    Trạng thái: <strong className="text-ink-800">{rain !== null ? "Trực tiếp" : weatherTide?.rain_status === "LIVE" ? "Bản tin trước" : "Đang cập nhật"}</strong>
                  </span>
                </div>

                {/* Tide Water Level */}
                <div className="bg-gradient-to-br from-white/95 to-ice-50/70 border border-indigo-100/80 rounded-2xl p-3 space-y-1 shadow-glass-sm">
                  <span className="text-[10px] text-ink-600 block font-bold uppercase tracking-wider flex items-center gap-1">
                    <Waves className="w-3 h-3 text-cyan-600" />
                    Thủy triều {weatherTide?.tide_station ? `(${weatherTide.tide_station})` : ""}
                  </span>
                  <div className="font-black text-sm text-ink-950">
                    {tide !== null ? (
                      <span>{tide.toFixed(2)} m</span>
                    ) : (
                      <span className="text-xs text-ink-500 font-normal">Chưa có bản tin mới</span>
                    )}
                  </div>
                  <span className="text-[10px] text-ink-500 block font-medium">
                    Hệ mốc: <strong className="text-ink-800">Hòn Dấu</strong>
                  </span>
                </div>
              </div>

              {tide !== null && weatherTide?.is_high_tide_alert && (
                <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-2xl text-[11px] text-rose-800 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  <span className="font-medium">
                    Cảnh báo triều cường: Mực nước vượt ngưỡng Báo động II (&ge; 1.50m)
                  </span>
                </div>
              )}

              <div className="pt-1 text-[9px] text-ink-400 text-center font-mono">
                Nguồn mưa: Open-Meteo · Triều: {weatherTide?.tide_station || "chưa có bản tin"}
              </div>
            </div>
          </div>
        </aside>

        {/* Right Main Map Container */}
        <main
          className={`spatial-map flex-1 h-full min-w-0 relative md:pb-0 ${
            sheetExpanded ? "pb-[min(55dvh,580px)]" : "pb-[min(37dvh,280px)]"
          }`}
        >
          <MapContainer
            pitch={pitch3D ? 60 : 0}
            showFloodObservations={false}
            cameras={cameras}
            recommendedRoute={recommendedRoute}
            alternativeRoutes={alternativeRoutes}
            highlightedSegment={
              selectedStepIndex === null ? null : recommendedRoute?.segments[selectedStepIndex]
            }
            origin={origin}
            destination={destination}
            currentLocation={currentLocation}
            locationFocusToken={locationFocusToken}
            mapSelectionMode={mapSelectionMode}
            onMapClickCoordinates={handleMapClick}
            onSelectCamera={setSelectedCamera}
            onSelectRoute={handleSelectRoute}
          />
        </main>
      </div>

      <nav className="spatial-dock liquid-pill" aria-label="Điều khiển không gian">
        <Link href="/" title="Tổng quan dữ liệu"><Home size={17}/><span>Khám phá</span></Link><i/>
        <button onClick={() => setPitch3D(!pitch3D)} aria-pressed={pitch3D}><Box size={17}/><span>{pitch3D ? "3D" : "2D"}</span></button>
      </nav>
      {/* Camera Evidence Modal */}
      <CameraEvidenceModal
        inspector
        camera={selectedCamera}
        onClose={() => setSelectedCamera(null)}
      />
    </div>
  );
}
