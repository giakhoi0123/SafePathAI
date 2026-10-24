"use client";

import { cameraObservationStatus, observationTime } from "../lib/observations";
import React, { useEffect, useRef, useState } from "react";
import {
  CameraEvidence,
  CameraImageMetadata,
  DataSourceStatus,
  EvidenceEligibility,
  ImageAccessStatus,
  RiskLevel,
  LocationWeatherResponse,
  NearbyTrafficNewsResponse,
} from "../types/contracts";
import {
  fetchCameraMetadata,
  getCameraImageUrl,
  getCameraEnhancedImageUrl,
  getCameraAnalyzedImageUrl,
  getLocationWeather,
  getNearbyTrafficNews,
  registerActiveViewedCameras,
  unregisterActiveViewedCamera,
} from "../services/api";
import {
  X,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  Car,
  Droplets,
  Clock,
  Camera,
  Radio,
  Info,
  ImageOff,
  ShieldCheck,
  Eye,
  FileCheck,
  RefreshCw,
  ExternalLink,
  Lock,
  Sparkles,
  CloudSun,
  Newspaper,
} from "lucide-react";

interface CameraEvidenceModalProps {
  inspector?: boolean;
  camera: CameraEvidence | null;
  onClose: () => void;
}

export const CameraEvidenceModal: React.FC<CameraEvidenceModalProps> = ({
  camera,
  onClose,
  inspector = false,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!camera) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("keydown", close); previous?.focus(); };
  }, [camera?.cam_id]);
  const [activeView, setActiveView] = useState<"original" | "enhanced" | "analyzed">("original");
  const [imageError, setImageError] = useState(false);
  const [metadata, setMetadata] = useState<CameraImageMetadata | null>(null);
  const [, setIsLoadingMetadata] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [imgTimestamp, setImgTimestamp] = useState<number>(Date.now());
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const hadValidImageRef = useRef(false);
  const [cooldown, setCooldown] = useState(0);
  const [localWeather, setLocalWeather] = useState<LocationWeatherResponse | null>(null);
  const [trafficNews, setTrafficNews] = useState<NearbyTrafficNewsResponse | null>(null);
  const [loadingNews, setLoadingNews] = useState(false);

  // Priority 60s active refresh registration & periodic polling while modal is open
  useEffect(() => {
    if (!camera?.cam_id) return;
    const camId = camera.cam_id;

    // Immediately lease Priority 1 for this camera (90s TTL)
    registerActiveViewedCameras([camId], 90).catch(() => {});
    setLastCheckTime(new Date());

    const interval = setInterval(async () => {
      try {
        setIsAutoRefreshing(true);
        // Renew 90s priority lease
        await registerActiveViewedCameras([camId], 90);
        // Fetch latest metadata
        const updatedMeta = await fetchCameraMetadata(camId);
        setLastCheckTime(new Date());

        setMetadata((prev) => {
          if (!prev) return updatedMeta;
          const hashChanged = updatedMeta.image_hash && updatedMeta.image_hash !== prev.image_hash;
          const successChanged = updatedMeta.last_success_at && updatedMeta.last_success_at !== prev.last_success_at;

          if ((hashChanged || successChanged) && updatedMeta.has_image) {
            // Preload new snapshot image to avoid UI flicker
            if (typeof window !== "undefined") {
              const preloadImg = new window.Image();
              const newSrc = `${getCameraImageUrl(camId)}?t=${Date.now()}`;
              preloadImg.src = newSrc;
              preloadImg.onload = () => {
                setImgTimestamp(Date.now());
                setImageError(false);
                hadValidImageRef.current = true;
              };
            }
          } else if (!updatedMeta.has_image && !hadValidImageRef.current) {
            setImageError(true);
          }
          return updatedMeta;
        });
      } catch (e) {
        console.debug("Auto-refresh check error:", e);
      } finally {
        setIsAutoRefreshing(false);
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      unregisterActiveViewedCamera(camId).catch(() => {});
    };
  }, [camera?.cam_id]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  // Load localized weather & nearby traffic news for camera GPS
  useEffect(() => {
    if (!camera || !Number.isFinite(camera.lat) || !Number.isFinite(camera.lng)) {
      setLocalWeather(null);
      setTrafficNews(null);
      return;
    }
    let active = true;
    getLocationWeather(camera.lat, camera.lng)
      .then((w) => {
        if (active) setLocalWeather(w);
      })
      .catch(() => {});

    setLoadingNews(true);
    getNearbyTrafficNews(camera.lat, camera.lng, 3.0)
      .then((n) => {
        if (active) setTrafficNews(n);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingNews(false);
      });

    return () => {
      active = false;
    };
  }, [camera?.cam_id, camera?.lat, camera?.lng, refreshKey]);

  // Load technical snapshot metadata whenever modal opens
  useEffect(() => {
    if (!camera) {
      setMetadata(null);
      setImageError(false);
      setActiveView("original");
      hadValidImageRef.current = false;
      return;
    }
    let active = true;
    setMetadata(null);
    setImageError(false);
    setIsLoadingMetadata(true);

    fetchCameraMetadata(camera.cam_id)
      .then((meta) => {
        if (!active) return;
        setMetadata(meta);
        setLastCheckTime(new Date());
        if (!meta.has_image) {
          setImageError(true);
          hadValidImageRef.current = false;
        } else {
          hadValidImageRef.current = true;
        }
      })
      .catch(() => {
        // Fallback to basic camera object if metadata endpoint fails
      })
      .finally(() => {
        if (active) setIsLoadingMetadata(false);
      });
    return () => { active = false; };
  }, [camera?.cam_id, refreshKey]);

  if (!camera) return null;

  const hasFloodRatio = camera.flood_ratio !== null && camera.flood_ratio !== undefined;
  const floodPercent = hasFloodRatio ? Math.round((camera.flood_ratio as number) * 100) : null;

  const hasVehicleCount = camera.vehicle_count !== null && camera.vehicle_count !== undefined;
  const vehicleCountVal = hasVehicleCount ? camera.vehicle_count : null;

  const hasDensity = camera.traffic_density_score !== null && camera.traffic_density_score !== undefined;
  const densityPercent = hasDensity ? Math.round((camera.traffic_density_score as number) * 100) : null;

  // Freshness calculation
  const updatedDate = new Date(camera.updated_at);
  const now = new Date();
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - updatedDate.getTime()) / 1000));
  const freshnessText =
    diffSeconds < 60
      ? `${diffSeconds} giây trước`
      : diffSeconds < 3600
      ? `${Math.floor(diffSeconds / 60)} phút trước`
      : `${Math.floor(diffSeconds / 3600)} giờ trước`;

  const accessStatus = metadata?.image_access_status || camera.image_access_status || ImageAccessStatus.UNAVAILABLE;
  const eligibility = metadata?.evidence_eligibility || camera.evidence_eligibility || EvidenceEligibility.NOT_VERIFIED_FOR_ROUTING;
  const isEligibleForRouting = eligibility === EvidenceEligibility.ROUTING_ELIGIBLE;
  const isModelAnalyzed = camera.model_status === "INFERENCE_COMPLETED" || metadata?.model_status === "INFERENCE_COMPLETED";

  // Image Access Status Badge
  const getImageAccessBadge = () => {
    switch (accessStatus) {
      case ImageAccessStatus.VIEWABLE_PUBLIC:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            Ảnh xem công khai
          </span>
        );
      case ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Lock className="w-3 h-3 text-amber-600" />
            Hạn chế truy cập ngoài (Cần phiên Sở GTVT)
          </span>
        );
      case ImageAccessStatus.VIEWABLE_AUTHORIZED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <ShieldCheck className="w-3 h-3 text-blue-600" />
            Ủy quyền chính thức
          </span>
        );
      case ImageAccessStatus.UNAVAILABLE:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-ink-500 border border-slate-200">
            <ImageOff className="w-3 h-3 text-ink-400" />
            Chưa có ảnh
          </span>
        );
    }
  };

  // Eligibility Badge
  const getEligibilityBadge = () => {
    if (isEligibleForRouting) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          Đủ chuẩn định tuyến
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-ink-600 border border-slate-200">
        <Info className="w-3 h-3 text-ink-400" />
        Chỉ xem tham khảo (Chưa chuẩn hóa định tuyến)
      </span>
    );
  };

  // Status Badge
  const getStatusBadge = (status: DataSourceStatus) => {
    switch (status) {
      case DataSourceStatus.LIVE:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Radio className="w-3 h-3 animate-pulse text-emerald-600" />
            Trực tiếp (Live)
          </span>
        );
      case DataSourceStatus.STALE:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            Bản tin trước đó
          </span>
        );
      case DataSourceStatus.SIMULATED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Radio className="w-3 h-3 text-purple-600" />
            Thử nghiệm
          </span>
        );
    }
  };

  // Risk Badge
  const getRiskBadge = (risk: RiskLevel) => {
    switch (risk) {
      case RiskLevel.CRITICAL:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-300">
            <ShieldAlert className="w-3.5 h-3.5" />
            CẢNH BÁO RỦI RO CAO
          </span>
        );
      case RiskLevel.MODERATE:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            LƯU Ý RỦI RO VỪA
          </span>
        );
      case RiskLevel.SAFE:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-300">
            <CheckCircle className="w-3.5 h-3.5" />
            AN TOÀN (SAFE)
          </span>
        );
      case RiskLevel.INSUFFICIENT_EVIDENCE:
      case RiskLevel.UNKNOWN:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-ink-600 border border-slate-200">
            <Info className="w-3.5 h-3.5" />
            CHƯA XÁC MINH (Đang cập nhật)
          </span>
        );
    }
  };

  const handleRetry = () => {
    if (cooldown > 0) return;
    setCooldown(5);
    setImageError(false);
    if (camera?.cam_id) {
      registerActiveViewedCameras([camera.cam_id], 90).catch(() => {});
    }
    setImgTimestamp(Date.now());
    setRefreshKey((k) => k + 1);
  };

  const quality = metadata?.image_quality || camera.image_quality;
  const currentImageUrl =
    activeView === "enhanced"
      ? getCameraEnhancedImageUrl(camera.cam_id)
      : activeView === "analyzed"
      ? getCameraAnalyzedImageUrl(camera.cam_id)
      : getCameraImageUrl(camera.cam_id);

  const sourceUrl =
    metadata?.source_url ||
    (camera as any).source_url ||
    (camera as any).provider_snapshot_url ||
    (camera.cam_id ? `http://giaothong.hochiminhcity.gov.vn:8007/Render/CameraHandler.ashx?id=${camera.cam_id}` : undefined);

  const isPlaceholder = Boolean(
    camera.image_status_reason?.includes("PLACEHOLDER") ||
    metadata?.image_status_reason?.includes("PLACEHOLDER") ||
    (metadata as any)?.failure_reason?.includes("PLACEHOLDER") ||
    (!metadata?.has_image && !camera.has_image)
  );

  const retrievedAt = metadata?.retrieved_at ?? camera.retrieved_at;
  const capturedAtRaw = metadata?.captured_at || (camera as any).captured_at;
  const capturedAtDate = capturedAtRaw ? new Date(capturedAtRaw) : null;
  const lastAttemptDate = metadata?.last_attempt_at ? new Date(metadata.last_attempt_at) : lastCheckTime;
  const lastSuccessDate = metadata?.last_success_at ? new Date(metadata.last_success_at) : null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`Bằng chứng camera ${camera.name}`}
      data-testid="camera-evidence-modal"
      className={inspector ? "evidence-inspector" : "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-md animate-fadeIn"}
    >
      <div
        className="relative w-full max-w-2xl glass-panel-elevated rounded-3xl shadow-glass-elevated overflow-hidden flex flex-col border border-white/95 text-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200/80 bg-white/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-600">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 bg-slate-100 text-indigo-700 rounded-full border border-slate-200">
                  {camera.code || "CAM"}
                </span>
                <h3 className="text-base font-bold text-ink-950 tracking-wide">
                  {camera.name}
                </h3>
              </div>
              <p className="text-xs text-ink-500 mt-0.5">
                {camera.district || "Thành phố Hồ Chí Minh"} • Tọa độ GPS: {camera.lat.toFixed(4)}, {camera.lng.toFixed(4)}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Đóng chi tiết camera"
            className="p-2 text-ink-400 hover:text-ink-800 hover:bg-slate-100 rounded-full transition"
            title="Đóng modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Status Badges Row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {getStatusBadge(cameraObservationStatus(camera) as DataSourceStatus)}
              {getRiskBadge(camera.risk_level)}
              {getImageAccessBadge()}
              {getEligibilityBadge()}
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50/90 text-indigo-700 border border-indigo-200/90 shadow-glass-sm"
                title="Camera đang mở chi tiết được ưu tiên nạp ảnh định kỳ mỗi 60 giây"
              >
                <span className={`w-2 h-2 rounded-full bg-emerald-500 ${isAutoRefreshing ? "animate-ping" : "animate-pulse"}`} />
                <span>Kiểm tra ảnh tự động mỗi ~1 phút</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 text-xs font-mono text-ink-600">
              <div className="flex items-center gap-1.5" title="Thời điểm bộ lập lịch vừa kiểm tra nguồn camera">
                <RefreshCw className={`w-3.5 h-3.5 text-indigo-500 ${isAutoRefreshing ? "animate-spin" : ""}`} />
                <span>
                  Kiểm tra: {lastAttemptDate && !isNaN(lastAttemptDate.getTime())
                    ? lastAttemptDate.toLocaleTimeString("vi-VN")
                    : "Đang kiểm tra..."}
                </span>
              </div>
              <div className="flex items-center gap-1.5" title="Thời điểm nhận ảnh mới thành công từ camera">
                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                <span>
                  Nhận ảnh: {lastSuccessDate && !isNaN(lastSuccessDate.getTime())
                    ? lastSuccessDate.toLocaleTimeString("vi-VN")
                    : metadata?.has_image
                    ? observationTime(retrievedAt)
                    : "Chưa nhận"}
                </span>
              </div>
              <div className="flex items-center gap-1.5" title="Thời điểm camera ghi hình thực tế nếu có watermark">
                <Radio className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Chụp: {capturedAtDate && !isNaN(capturedAtDate.getTime())
                    ? capturedAtDate.toLocaleTimeString("vi-VN")
                    : "Chưa xác minh"}
                </span>
              </div>
              <div className="flex items-center gap-1.5" title="Thời điểm hệ thống SafePathAI nạp snapshot">
                <FileCheck className="w-3.5 h-3.5 text-slate-400" />
                <span>Truy xuất: {observationTime(retrievedAt)}</span>
              </div>
            </div>

            {/* Localized Weather at Camera Coordinate */}
            {localWeather && localWeather.status === "LIVE" && (
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-sky-50/90 border border-sky-200/80 text-xs text-sky-950 shadow-glass-sm mt-1">
                <CloudSun className="w-4 h-4 text-sky-600 shrink-0" />
                <span>
                  <strong>Thời tiết tại điểm quan sát:</strong> {localWeather.weather_description}
                  {localWeather.temperature_c !== null && ` • ${localWeather.temperature_c}°C`}
                  {localWeather.rain_mm_per_hour !== null && ` • Lượng mưa: ${localWeather.rain_mm_per_hour} mm/h`}
                  {localWeather.wind_speed_kmh !== null && ` • Gió: ${localWeather.wind_speed_kmh} km/h`}
                </span>
              </div>
            )}
          </div>

          {/* View Toggle Tabs: Original vs Enhanced vs Analyzed + Image Quality Badge */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <div className="inline-flex p-1 bg-white/70 backdrop-blur-md rounded-2xl border border-white/90 shadow-glass-sm text-xs">
              <button
                type="button"
                onClick={() => {
                  setImageError(false);
                  setActiveView("original");
                }}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeView === "original"
                    ? "bg-white text-indigo-700 shadow-sm border border-slate-200/80"
                    : "text-ink-600 hover:text-ink-950"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Ảnh gốc (Nguồn)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImageError(false);
                  setActiveView("enhanced");
                }}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeView === "enhanced"
                    ? "bg-gradient-to-r from-indigo-600 via-indigo-500 to-sky-500 text-white shadow-sm"
                    : "text-ink-600 hover:text-ink-950"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Ảnh tăng cường (Hỗ trợ AI)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImageError(false);
                  setActiveView("analyzed");
                }}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeView === "analyzed"
                    ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-sm"
                    : "text-ink-600 hover:text-ink-950"
                }`}
              >
                <Car className="w-3.5 h-3.5" />
                <span>Phát hiện AI (Overlay)</span>
              </button>
            </div>

            {/* Image Quality Badge */}
            {quality && (
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                    quality.quality_status === "HIGH_QUALITY"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : quality.quality_status === "ACCEPTABLE"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : quality.quality_status === "POOR"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  }`}
                >
                  Chất lượng:{" "}
                  {quality.quality_status === "HIGH_QUALITY"
                    ? "Cao"
                    : quality.quality_status === "ACCEPTABLE"
                    ? "Chấp nhận được"
                    : quality.quality_status === "POOR"
                    ? "Kém"
                    : "Suy giảm"}
                </span>
              </div>
            )}
          </div>

          {/* Camera Image Frame */}
          <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[4/3] flex items-center justify-center shadow-inner">
            {imageError ? (
              <div className="flex flex-col items-center justify-center p-6 text-center text-ink-600 space-y-3">
                <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-glass-sm">
                  <ImageOff className="w-8 h-8 text-ink-400" />
                </div>
                <div>
                  <span className="font-semibold text-xs text-ink-900 block">
                    {isPlaceholder
                      ? "Camera hiện chưa cung cấp ảnh hợp lệ"
                      : accessStatus === ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
                      ? "Cổng Giao Thông Hạn Chế Truy Cập Trực Tiếp (HTTP 403)"
                      : "Chưa có ảnh snapshot trong bộ đệm"}
                  </span>
                  <p className="text-[11px] text-ink-500 max-w-md mt-1 leading-relaxed">
                    {isPlaceholder
                      ? "Máy chủ camera của Cổng Giao thông TP.HCM đang phản hồi khung hình báo lỗi 'IMAGE NOT AVAILABLE' (tín hiệu camera gián đoạn hoặc thiết bị tại hiện trường đang mất kết nối). SafePathAI bảo vệ nguyên tắc Zero-Mock, tuyệt đối không dùng ảnh giả lập."
                      : accessStatus === ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
                      ? "Máy chủ Cổng Thông tin Giao thông TP.HCM yêu cầu xác thực phiên ASP.NET để truy xuất ảnh từ xa. SafePathAI tuyệt đối không sử dụng ảnh giả lập theo nguyên tắc Zero-Mock."
                      : "Camera này chưa có ảnh snapshot được lưu hợp lệ hoặc khung hình nhận được chưa vượt qua kiểm định tính toàn vẹn."}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={cooldown > 0}
                    className={`aurora-btn-primary flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                      cooldown > 0 ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${cooldown > 0 ? "animate-spin" : ""}`} />
                    <span>{cooldown > 0 ? `Thử lại sau (${cooldown}s)` : "Thử tải lại"}</span>
                  </button>

                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-pill flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-ink-700 text-xs font-medium border border-slate-200 hover:text-ink-950 transition cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Xem nguồn gốc Sở GTVT</span>
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <>
                <img
                  key={`${activeView}-${imgTimestamp}`}
                  src={`${currentImageUrl}${currentImageUrl.includes("?") ? "&" : "?"}t=${imgTimestamp}`}
                  alt={`Camera snapshot ${camera.name} (${activeView})`}
                  className="w-full h-full object-cover transition-opacity duration-300"
                  onError={() => {
                    if (!hadValidImageRef.current) {
                      setImageError(true);
                    }
                  }}
                />

                {/* Provenance Badge */}
                <div className="absolute top-3 left-3 glass-panel px-3 py-1.5 rounded-xl border border-white/90 text-[11px] text-ink-900 font-medium flex items-center gap-2 shadow-sm">
                  <div className={`w-2 h-2 rounded-full ${isModelAnalyzed ? "bg-emerald-500 animate-ping" : "bg-indigo-500"}`} />
                  <span>
                    {activeView === "analyzed"
                      ? "Ảnh nhận diện AI • Hộp định danh phương tiện & Phân đoạn nước"
                      : activeView === "enhanced"
                      ? "Ảnh xử lý tăng cường • Thích ứng sáng & chi tiết (Hỗ trợ AI)"
                      : isModelAnalyzed
                      ? "Ảnh gốc camera giao thông • Đã phân tích AI"
                      : "Ảnh gốc thô • Cổng Sở GTVT (Đang xử lý)"}
                  </span>
                </div>

                {floodPercent !== null && floodPercent >= 35 && (
                  <div className="absolute bottom-3 left-3 right-3 bg-rose-50/95 border border-rose-300 backdrop-blur-md p-2.5 rounded-xl text-xs text-rose-800 flex items-center gap-2 shadow-md">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      <strong>Tỷ lệ pixel nghi là nước:</strong> {floodPercent}% trong vùng quan sát. Không đủ cơ sở suy ra độ sâu hoặc khả năng đi qua.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Enhancement / Detection Notice & Quality Flags Bar */}
          {activeView === "analyzed" ? (
            <div className="p-3 rounded-2xl bg-teal-50/80 border border-teal-200/80 text-[11px] text-teal-900 flex items-start gap-2 shadow-glass-sm">
              <Car className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block text-teal-950 font-bold">Lớp phủ nhận diện AI (Computer Vision Detection Overlay):</strong>
                <p className="mt-0.5 text-teal-800 leading-relaxed">
                  Khung hình hiển thị các phương tiện giao thông được SafePath Vision AI phát hiện trực quan kèm hộp nhận diện phương tiện. Toàn bộ phát hiện được đối chiếu từ dữ liệu hình ảnh camera nguồn thực tế.
                </p>
              </div>
            </div>
          ) : activeView === "enhanced" ? (
            <div className="p-3 rounded-2xl bg-indigo-50/80 border border-indigo-200/80 text-[11px] text-indigo-900 flex items-start gap-2 shadow-glass-sm">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block text-indigo-950 font-bold">Chế độ tăng cường hình ảnh (AI Assistive Enhancement):</strong>
                <p className="mt-0.5 text-indigo-800 leading-relaxed">
                  Khung hình được tối ưu qua pipeline thích ứng: Cân chỉnh Gamma cho vùng tối/đêm, tăng cường tương phản cục bộ CLAHE trên kênh L, giảm nhiễu biên và làm rõ viền chi tiết unsharp masking. <strong>Ảnh gốc luôn được giữ nguyên và bảo lưu làm nguồn bằng chứng pháp lý độc lập.</strong>
                </p>
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-2xl bg-white/60 border border-slate-200/70 text-[11px] text-ink-600 flex items-center justify-between flex-wrap gap-2">
              <span className="text-ink-700">
                Ảnh gốc được tiếp nhận nguyên bản từ camera giao thông TP.HCM.
              </span>
              {quality?.quality_flags && quality.quality_flags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {quality.quality_flags.map((flag) => (
                    <span
                      key={flag}
                      className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-100 text-ink-700 border border-slate-200"
                    >
                      {flag === "LOW_LIGHT"
                        ? "Thiếu sáng"
                        : flag === "BLURRY"
                        ? "Mờ nét"
                        : flag === "NOISY"
                        ? "Nhiễu hạt"
                        : flag === "LOW_RESOLUTION"
                        ? "Phân giải thấp"
                        : flag === "PARTIAL_OCCLUSION"
                        ? "Vật cản"
                        : flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quality-Aware Fallback Notice when 0 vehicles detected on poor/degraded frames */}
          {vehicleCountVal === 0 &&
            (quality?.quality_status === "POOR" ||
              quality?.quality_status === "DEGRADED" ||
              quality?.quality_metrics?.is_low_quality ||
              camera.image_status_reason === "POOR_QUALITY_INSUFFICIENT_EVIDENCE") && (
              <div className="p-3.5 bg-amber-50/95 border border-amber-300 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5 shadow-glass-sm animate-fadeIn">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-amber-950 font-bold">
                    0 phát hiện · Chất lượng ảnh hạn chế · Không đủ cơ sở kết luận mật độ giao thông
                  </strong>
                  <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
                    Camera ở tình trạng thiếu sáng hoặc mất nét đáng kể. Theo nguyên tắc Zero-Mock và bảo đảm an toàn, hệ thống không kết luận đường vắng/an toàn mà giữ trạng thái <strong>CHƯA XÁC MINH (UNKNOWN)</strong>.
                  </p>
                </div>
              </div>
            )}

          {/* Metrics Dashboard */}
          <div className="grid grid-cols-2 gap-3">
            {/* Vehicle Count */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-200/80">
              <div className="flex items-center gap-1.5 text-ink-500 text-xs mb-1">
                <Car className="w-4 h-4 text-emerald-600" />
                <span>Phương tiện quan sát được</span>
              </div>
              <div className="text-xl font-black text-ink-950">
                {vehicleCountVal !== null ? (
                  <>
                    {vehicleCountVal}{" "}
                    <span className="text-xs font-normal text-ink-500">xe</span>
                  </>
                ) : (
                  <span className="text-xs font-normal text-ink-400">Đang quan trắc</span>
                )}
              </div>
              <p className="text-[10px] text-ink-500 mt-2">
                {typeof vehicleCountVal === "number" && vehicleCountVal > 0
                  ? "Phát hiện trực quan bởi SafePath AI"
                  : "Khu vực thông thoáng"}
              </p>
            </div>

            {/* Congestion Density */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-200/80">
              <div className="flex items-center gap-1.5 text-ink-500 text-xs mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Mật độ giao thông</span>
              </div>
              <div className="text-xl font-black text-ink-950">
                {densityPercent !== null ? (
                  `${densityPercent}%`
                ) : (
                  <span className="text-xs font-normal text-ink-400">Đang cập nhật</span>
                )}
              </div>
              {densityPercent !== null ? (
                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      densityPercent >= 70
                        ? "bg-rose-500"
                        : densityPercent >= 40
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, densityPercent)}%` }}
                  />
                </div>
              ) : (
                <p className="text-[10px] text-ink-400 mt-2">
                  Dựa trên phương tiện quy đổi
                </p>
              )}
            </div>
          </div>

          {/* Nearby Traffic News Panel (Replacing unverified water area bar) */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200/70 pb-2">
              <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-ink-800">
                <Newspaper className="w-4 h-4 text-indigo-600" />
                <span>Tin giao thông gần đây (Bán kính 3km)</span>
              </div>
              {trafficNews && trafficNews.count > 0 && (
                <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                  {trafficNews.count} tin mới
                </span>
              )}
            </div>

            {loadingNews ? (
              <div className="py-4 text-center text-xs text-ink-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                <span>Đang tải thông tin giao thông khu vực...</span>
              </div>
            ) : trafficNews && trafficNews.items.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {trafficNews.items.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl bg-white/80 border border-slate-200/70 text-xs space-y-1 hover:border-indigo-300 transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-ink-900 leading-snug line-clamp-1">
                        {item.title}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                          item.severity === "CRITICAL"
                            ? "bg-rose-100 text-rose-800"
                            : item.severity === "WARNING"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {item.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-600 line-clamp-2 leading-relaxed">
                      {item.summary}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-ink-400 pt-0.5">
                      <span>{item.source} • Cách ~{item.distance_km ? `${item.distance_km}km` : "gần đây"}</span>
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline flex items-center gap-0.5"
                        >
                          Chi tiết <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/80 text-xs text-ink-700 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>{trafficNews?.message || "Chưa tìm thấy bản tin giao thông phù hợp trong các nguồn đang theo dõi."}</span>
              </div>
            )}
          </div>

          {/* Verification & Provenance Metadata Panel */}
          <div className="glass-panel rounded-2xl p-3.5 space-y-2 text-xs border border-slate-200/80">
            <span className="text-ink-500 font-bold block uppercase tracking-wider text-[10px]">
              Hồ sơ Xác minh & Tính Hợp Lệ Định Tuyến
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-ink-700">
              <div className="flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>
                  Trạng thái góc nhìn: <strong>{camera.spatial_match_status === "OBSERVED_SEGMENT_VERIFIED" ? "Khớp đoạn đường xác minh" : "Cận kề tuyến đường (Ứng viên)"}</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>
                  Kiểm tra tầm nhìn (LOS): <strong>{camera.line_of_sight_verified ? "Đã kiểm chứng" : "Chưa kiểm chứng vật cản"}</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5 col-span-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Nguồn tọa độ: {camera.coordinate_source_url || "Sở GTVT TP.HCM (VDMS AjaxPro POINT)"}</span>
              </div>
              {metadata?.etag && (
                <div className="flex items-center gap-1.5 col-span-2 text-ink-400 font-mono text-[10px]">
                  <span>ETag: {metadata.etag} • Content-Length: {metadata.content_length} bytes</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200/80 bg-white/70 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 glass-pill hover:bg-white text-ink-800 text-sm font-semibold rounded-xl border border-slate-200 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
