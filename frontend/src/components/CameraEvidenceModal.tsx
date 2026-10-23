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
import { fetchCameraMetadata, getCameraImageUrl } from "../services/api";
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
} from "lucide-react";

interface CameraEvidenceModalProps {
  camera: CameraEvidence | null;
  onClose: () => void;
}

export const CameraEvidenceModal: React.FC<CameraEvidenceModalProps> = ({
  camera,
  onClose,
}) => {
  const [imageError, setImageError] = useState(false);
  const [metadata, setMetadata] = useState<CameraImageMetadata | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
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
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle className="w-3 h-3 text-emerald-400" />
            Ảnh xem công khai
          </span>
        );
      case ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Lock className="w-3 h-3 text-amber-400" />
            Hạn chế truy cập ngoài (Cần phiên Sở GTVT)
          </span>
        );
      case ImageAccessStatus.VIEWABLE_AUTHORIZED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
            <ShieldCheck className="w-3 h-3 text-blue-400" />
            Ủy quyền chính thức
          </span>
        );
      case ImageAccessStatus.UNAVAILABLE:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <ImageOff className="w-3 h-3 text-slate-500" />
            Chưa có ảnh
          </span>
        );
    }
  };

  // Eligibility Badge
  const getEligibilityBadge = () => {
    if (isEligibleForRouting) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          Đủ chuẩn định tuyến
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
        <Info className="w-3 h-3 text-slate-400" />
        Chỉ xem tham khảo (Chưa chuẩn hóa định tuyến)
      </span>
    );
  };

  // Status Badge
  const getStatusBadge = (status: DataSourceStatus) => {
    switch (status) {
      case DataSourceStatus.LIVE:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Radio className="w-3 h-3 animate-pulse text-emerald-400" />
            LIVE (Thời gian thực)
          </span>
        );
      case DataSourceStatus.STALE:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <Clock className="w-3 h-3 text-amber-400" />
            STALE (Chậm cập nhật)
          </span>
        );
      case DataSourceStatus.SIMULATED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <Radio className="w-3 h-3 text-purple-400" />
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
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
            <ShieldAlert className="w-3.5 h-3.5" />
            NGUY KỊCH (CRITICAL)
          </span>
        );
      case RiskLevel.MODERATE:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
            <AlertTriangle className="w-3.5 h-3.5" />
            RỦI RO VỪA (MODERATE)
          </span>
        );
      case RiskLevel.SAFE:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
            <CheckCircle className="w-3.5 h-3.5" />
            AN TOÀN (SAFE)
          </span>
        );
      case RiskLevel.INSUFFICIENT_EVIDENCE:
      case RiskLevel.UNKNOWN:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-bold bg-slate-500/20 text-slate-400 border border-slate-500/40">
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

  const imageUrl = getCameraImageUrl(camera.cam_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 bg-slate-800 text-blue-400 rounded border border-slate-700">
                  {camera.code || "CAM"}
                </span>
                <h3 className="text-base font-bold text-white tracking-wide">
                  {camera.name}
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {camera.district || "Thành phố Hồ Chí Minh"} • Tọa độ GPS: {camera.lat.toFixed(4)}, {camera.lng.toFixed(4)}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
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
            <div className="text-xs text-slate-400 flex items-center gap-1.5 font-mono">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>Tiếp nhận: {updatedDate.toLocaleTimeString("vi-VN")} ({freshnessText})</span>
            </div>
          </div>

          {/* Camera Image Frame */}
          <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-[4/3] flex items-center justify-center shadow-inner">
            {imageError ? (
              <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-3">
                <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700">
                  <ImageOff className="w-8 h-8 text-slate-400" />
                </div>
                <div>
                  <span className="font-semibold text-xs text-slate-200 block">
                    {accessStatus === ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
                      ? "Cổng Giao Thông Hạn Chế Truy Cập Trực Tiếp (HTTP 403)"
                      : "Chưa có ảnh snapshot trong bộ đệm"}
                  </span>
                  <p className="text-[11px] text-slate-400 max-w-md mt-1 leading-relaxed">
                    {accessStatus === ImageAccessStatus.EXTERNAL_ACCESS_RESTRICTED
                      ? "Máy chủ Cổng Thông tin Giao thông TP.HCM yêu cầu xác thực phiên ASP.NET để truy xuất ảnh từ xa. SafePathAI tuyệt đối không sử dụng ảnh giả lập theo nguyên tắc Zero-Mock."
                      : "Camera này chưa có ảnh snapshot được lưu hợp lệ hoặc khung hình nhận được là thông báo lỗi máy chủ (PLACEHOLDER_FRAME)."}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Thử tải lại</span>
                  </button>

                  {metadata?.source_url && (
                    <a
                      href={metadata.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
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
                  key={refreshKey}
                  src={`${imageUrl}?t=${refreshKey}`}
                  alt={`Camera snapshot ${camera.name}`}
                  className="w-full h-full object-cover"
                  onError={() => setImageError(true)}
                />

                {/* Provenance Badge */}
                <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 text-[11px] text-slate-200 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isModelAnalyzed ? "bg-emerald-400 animate-ping" : "bg-blue-400"}`} />
                  <span>
                    {isModelAnalyzed
                      ? "Đã phân tích ONNX YOLOv5n • Cổng 8007 Sở GTVT"
                      : "Snapshot thô • Cổng 8007 Sở GTVT (Chưa suy luận model)"}
                  </span>
                </div>

                {floodPercent !== null && floodPercent >= 35 && (
                  <div className="absolute bottom-3 left-3 right-3 bg-rose-950/90 border border-rose-500/50 backdrop-blur-md p-2.5 rounded-lg text-xs text-rose-200 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      <strong>Cảnh báo ngập sâu:</strong> Vùng nước chiếm {floodPercent}% mặt đường quan sát. Xe máy có nguy cơ chết máy cao!
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Computer Vision Metrics Dashboard (Truthful Null Rendering) */}
          <div className="grid grid-cols-3 gap-3">
            {/* Water Segmentation Ratio */}
            <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Droplets className="w-4 h-4 text-blue-400" />
                <span>Tỷ lệ diện tích nước</span>
              </div>
              <div className="text-xl font-black text-white">
                {floodPercent !== null ? `${floodPercent}%` : (
                  <span className="text-xs font-normal text-slate-500">Chưa kiểm định (N/A)</span>
                )}
              </div>
              {floodPercent !== null ? (
                <div className="w-full h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      floodPercent >= 35
                        ? "bg-rose-500"
                        : floodPercent >= 15
                        ? "bg-amber-500"
                        : "bg-blue-500"
                    }`}
                    style={{ width: `${Math.min(100, floodPercent)}%` }}
                  />
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 mt-2">
                  Chưa có trọng số model ngập
                </p>
              )}
            </div>

            {/* Vehicle Count */}
            <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Car className="w-4 h-4 text-emerald-400" />
                <span>Phương tiện đếm được</span>
              </div>
              <div className="text-xl font-black text-white">
                {vehicleCountVal !== null ? (
                  <>
                    {vehicleCountVal}{" "}
                    <span className="text-xs font-normal text-slate-400">xe</span>
                  </>
                ) : (
                  <span className="text-xs font-normal text-slate-500">Chưa phân tích</span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                {isModelAnalyzed ? "YOLOv5n ONNX (COCO)" : "Chưa thực thi model"}
              </p>
            </div>

            {/* Congestion Density */}
            <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Mật độ kẹt xe</span>
              </div>
              <div className="text-xl font-black text-white">
                {densityPercent !== null ? `${densityPercent}%` : (
                  <span className="text-xs font-normal text-slate-500">Chưa đo lường</span>
                )}
              </div>
              {densityPercent !== null ? (
                <div className="w-full h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
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
                <p className="text-[10px] text-slate-500 mt-2">
                  Dựa trên phương tiện quy đổi
                </p>
              )}
            </div>
          </div>

          {/* Verification & Provenance Metadata Panel */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2 text-xs">
            <span className="text-slate-400 font-semibold block uppercase tracking-wider text-[10px]">
              Hồ sơ Xác minh & Tính Hợp Lệ Định Tuyến
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
              <div className="flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>
                  Trạng thái góc nhìn: <strong>{camera.spatial_match_status === "OBSERVED_SEGMENT_VERIFIED" ? "Khớp đoạn đường xác minh" : "Cận kề tuyến đường (Ứng viên)"}</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>
                  Kiểm tra tầm nhìn (LOS): <strong>{camera.line_of_sight_verified ? "Đã kiểm chứng" : "Chưa kiểm chứng vật cản"}</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5 col-span-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Nguồn tọa độ: {camera.coordinate_source_url || "Sở GTVT TP.HCM (VDMS AjaxPro POINT)"}</span>
              </div>
              {metadata?.etag && (
                <div className="flex items-center gap-1.5 col-span-2 text-slate-400 font-mono text-[10px]">
                  <span>ETag: {metadata.etag} • Content-Length: {metadata.content_length} bytes</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-xl transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
