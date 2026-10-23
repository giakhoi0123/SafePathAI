"use client";

import React, { useEffect, useState } from "react";
import {
  CameraEvidence,
  CameraImageMetadata,
  DataSourceStatus,
  EvidenceEligibility,
  ImageAccessStatus,
  RiskLevel,
} from "../types/contracts";
import { fetchCameraMetadata, getCameraImageUrl, getCameraEnhancedImageUrl } from "../services/api";
import {
  X,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  Car,
  Droplets,
  Clock,
  MapPin,
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
} from "lucide-react";

interface CameraEvidenceModalProps {
  camera: CameraEvidence | null;
  onClose: () => void;
}

export const CameraEvidenceModal: React.FC<CameraEvidenceModalProps> = ({
  camera,
  onClose,
}) => {
  const [activeView, setActiveView] = useState<"original" | "enhanced">("original");
  const [imageError, setImageError] = useState(false);
  const [metadata, setMetadata] = useState<CameraImageMetadata | null>(null);
  const [, setIsLoadingMetadata] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load technical snapshot metadata whenever modal opens
  useEffect(() => {
    if (!camera) {
      setMetadata(null);
      setImageError(false);
      return;
    }
    setImageError(false);
    setIsLoadingMetadata(true);

    fetchCameraMetadata(camera.cam_id)
      .then((meta) => {
        setMetadata(meta);
        if (!meta.has_image) {
          setImageError(true);
        }
      })
      .catch(() => {
        // Fallback to basic camera object if metadata endpoint fails
      })
      .finally(() => {
        setIsLoadingMetadata(false);
      });
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
            LIVE (Thời gian thực)
          </span>
        );
      case DataSourceStatus.STALE:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            STALE (Chậm cập nhật)
          </span>
        );
      case DataSourceStatus.SIMULATED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Radio className="w-3 h-3 text-purple-600" />
            SIMULATED (Mô phỏng)
          </span>
        );
    }
  };

  // Risk Badge
  const getRiskBadge = (risk: RiskLevel) => {
    switch (risk) {
      case RiskLevel.CRITICAL:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-300 animate-pulse">
            <ShieldAlert className="w-3.5 h-3.5" />
            NGUY KỊCH (CRITICAL)
          </span>
        );
      case RiskLevel.MODERATE:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            RỦI RO VỪA (MODERATE)
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
            CHƯA XÁC MINH (UNKNOWN)
          </span>
        );
    }
  };

  const handleRetry = () => {
    setImageError(false);
    setRefreshKey((k) => k + 1);
  };

  const quality = metadata?.image_quality || camera.image_quality;
  const currentImageUrl =
    activeView === "enhanced"
      ? getCameraEnhancedImageUrl(camera.cam_id)
      : getCameraImageUrl(camera.cam_id);

  return (
    <div
      data-testid="camera-evidence-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fadeIn"
    >
      <div
        className="relative w-full max-w-2xl glass-panel-elevated rounded-3xl shadow-glass-elevated overflow-hidden flex flex-col border border-white/95 text-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200/80 bg-white/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-600">
              <MapPin className="w-5 h-5" />
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
              {getStatusBadge(camera.source_status)}
              {getRiskBadge(camera.risk_level)}
              {getImageAccessBadge()}
              {getEligibilityBadge()}
            </div>
            <div className="text-xs text-ink-500 flex items-center gap-1.5 font-mono">
              <Clock className="w-3.5 h-3.5 text-ink-400" />
              <span>Tiếp nhận: {updatedDate.toLocaleTimeString("vi-VN")} ({freshnessText})</span>
            </div>
          </div>

          {/* View Toggle Tabs: Original vs Enhanced + Image Quality Badge */}
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
                    {accessStatus === ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
                      ? "Cổng Giao Thông Hạn Chế Truy Cập Trực Tiếp (HTTP 403)"
                      : "Chưa có ảnh snapshot trong bộ đệm"}
                  </span>
                  <p className="text-[11px] text-ink-500 max-w-md mt-1 leading-relaxed">
                    {accessStatus === ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
                      ? "Máy chủ Cổng Thông tin Giao thông TP.HCM yêu cầu xác thực phiên ASP.NET để truy xuất ảnh từ xa. SafePathAI tuyệt đối không sử dụng ảnh giả lập theo nguyên tắc Zero-Mock."
                      : "Camera này chưa có ảnh snapshot được lưu hợp lệ hoặc khung hình nhận được là thông báo lỗi máy chủ (PLACEHOLDER_FRAME)."}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="aurora-btn-primary flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Thử tải lại</span>
                  </button>

                  {metadata?.source_url && (
                    <a
                      href={metadata.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-pill flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-ink-700 text-xs font-medium border border-slate-200 hover:text-ink-950 transition"
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
                  key={`${activeView}-${refreshKey}`}
                  src={`${currentImageUrl}${currentImageUrl.includes("?") ? "&" : "?"}t=${refreshKey}`}
                  alt={`Camera snapshot ${camera.name} (${activeView})`}
                  className="w-full h-full object-cover"
                  onError={() => setImageError(true)}
                />

                {/* Provenance Badge */}
                <div className="absolute top-3 left-3 glass-panel px-3 py-1.5 rounded-xl border border-white/90 text-[11px] text-ink-900 font-medium flex items-center gap-2 shadow-sm">
                  <div className={`w-2 h-2 rounded-full ${isModelAnalyzed ? "bg-emerald-500 animate-ping" : "bg-indigo-500"}`} />
                  <span>
                    {activeView === "enhanced"
                      ? "Ảnh xử lý tăng cường • Thích ứng sáng & chi tiết (Hỗ trợ AI)"
                      : isModelAnalyzed
                      ? "Ảnh gốc nguồn Sở GTVT • Đã phân tích ONNX"
                      : "Ảnh gốc thô • Cổng 8007 Sở GTVT (Chưa suy luận model)"}
                  </span>
                </div>

                {floodPercent !== null && floodPercent >= 35 && (
                  <div className="absolute bottom-3 left-3 right-3 bg-rose-50/95 border border-rose-300 backdrop-blur-md p-2.5 rounded-xl text-xs text-rose-800 flex items-center gap-2 shadow-md">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      <strong>Cảnh báo ngập sâu:</strong> Vùng nước chiếm {floodPercent}% mặt đường quan sát. Xe máy có nguy cơ chết máy cao!
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Enhancement Notice & Quality Flags Bar */}
          {activeView === "enhanced" ? (
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

          {/* Computer Vision Metrics Dashboard (Truthful Null Rendering) */}
          <div className="grid grid-cols-3 gap-3">
            {/* Water Segmentation Ratio */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-200/80">
              <div className="flex items-center gap-1.5 text-ink-500 text-xs mb-1">
                <Droplets className="w-4 h-4 text-indigo-600" />
                <span>Tỷ lệ diện tích nước</span>
              </div>
              <div className="text-xl font-black text-ink-950">
                {floodPercent !== null ? (
                  `${floodPercent}%`
                ) : (
                  <span className="text-xs font-normal text-ink-400">Chưa kiểm định (N/A)</span>
                )}
              </div>
              {floodPercent !== null ? (
                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      floodPercent >= 35
                        ? "bg-rose-500"
                        : floodPercent >= 15
                        ? "bg-amber-500"
                        : "bg-indigo-500"
                    }`}
                    style={{ width: `${Math.min(100, floodPercent)}%` }}
                  />
                </div>
              ) : (
                <p className="text-[10px] text-ink-400 mt-2">
                  Chưa có trọng số model ngập
                </p>
              )}
            </div>

            {/* Vehicle Count */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-200/80">
              <div className="flex items-center gap-1.5 text-ink-500 text-xs mb-1">
                <Car className="w-4 h-4 text-emerald-600" />
                <span>Phương tiện đếm được</span>
              </div>
              <div className="text-xl font-black text-ink-950">
                {vehicleCountVal !== null ? (
                  <>
                    {vehicleCountVal}{" "}
                    <span className="text-xs font-normal text-ink-500">xe</span>
                  </>
                ) : (
                  <span className="text-xs font-normal text-ink-400">Chưa phân tích</span>
                )}
              </div>
              <p className="text-[10px] text-ink-400 mt-2">
                {isModelAnalyzed ? "YOLOv5n ONNX (COCO)" : "Chưa thực thi model"}
              </p>
            </div>

            {/* Congestion Density */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-200/80">
              <div className="flex items-center gap-1.5 text-ink-500 text-xs mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Mật độ kẹt xe</span>
              </div>
              <div className="text-xl font-black text-ink-950">
                {densityPercent !== null ? (
                  `${densityPercent}%`
                ) : (
                  <span className="text-xs font-normal text-ink-400">Chưa đo lường</span>
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
