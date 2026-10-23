"use client";

import React from "react";
import { CameraEvidence, DataSourceStatus, RiskLevel } from "../types/contracts";
import { getCameraImageUrl } from "../services/api";
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
} from "lucide-react";

interface CameraEvidenceModalProps {
  camera: CameraEvidence | null;
  onClose: () => void;
}

export const CameraEvidenceModal: React.FC<CameraEvidenceModalProps> = ({
  camera,
  onClose,
}) => {
  const [imageError, setImageError] = React.useState(false);

  if (!camera) return null;

  const floodPercent = Math.round(camera.flood_ratio * 100);
  const densityPercent = Math.round(camera.traffic_density_score * 100);

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
            <div className="flex items-center gap-2">
              {getStatusBadge(camera.source_status)}
              {getRiskBadge(camera.risk_level)}
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-1.5 font-mono">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>Tiếp nhận: {updatedDate.toLocaleTimeString("vi-VN")} ({freshnessText})</span>
            </div>
          </div>

          {/* AI Analyzed Camera Image Frame */}
          <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-[4/3] flex items-center justify-center shadow-inner">
            {imageError ? (
              <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-2">
                <ImageOff className="w-10 h-10 text-slate-500" />
                <span className="font-semibold text-xs text-slate-300">
                  Ảnh camera chưa được tải về bộ đệm
                </span>
                <p className="text-[11px] text-slate-500 max-w-sm">
                  Theo quy định Zero-Mock, hệ thống chỉ hiển thị ảnh snapshot có bản quyền kiểm chứng từ máy chủ Sở GTVT TP.HCM. Không sử dụng ảnh minh họa hoặc ảnh giả lập.
                </p>
              </div>
            ) : (
              <>
                <img
                  src={getCameraImageUrl(camera.cam_id)}
                  alt={`Camera snapshot ${camera.name}`}
                  className="w-full h-full object-cover"
                  onError={() => setImageError(true)}
                />

                {/* Provenance Badge */}
                <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 text-[11px] text-slate-200 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>ONNX YOLOv5n • Cổng 8007 Sở GTVT</span>
                </div>

                {floodPercent >= 35 && (
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

          {/* Computer Vision Metrics Dashboard */}
          <div className="grid grid-cols-3 gap-3">
            {/* Water Segmentation Ratio */}
            <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Droplets className="w-4 h-4 text-blue-400" />
                <span>Tỷ lệ diện tích nước</span>
              </div>
              <div className="text-xl font-black text-white">
                {floodPercent}%
              </div>
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
            </div>

            {/* Vehicle Count */}
            <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Car className="w-4 h-4 text-emerald-400" />
                <span>Phương tiện đếm được</span>
              </div>
              <div className="text-xl font-black text-white">
                {camera.vehicle_count}{" "}
                <span className="text-xs font-normal text-slate-400">xe</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                YOLOv5n ONNX (COCO)
              </p>
            </div>

            {/* Congestion Density */}
            <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Mật độ kẹt xe</span>
              </div>
              <div className="text-xl font-black text-white">
                {densityPercent}%
              </div>
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
            </div>
          </div>

          {/* Verification & Provenance Metadata Panel */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2 text-xs">
            <span className="text-slate-400 font-semibold block uppercase tracking-wider text-[10px]">
              Hồ sơ Xác minh & Nguồn dữ liệu (Provenance)
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
              <div className="flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Trạng thái góc nhìn: <strong>{camera.spatial_match_status === "OBSERVED_SEGMENT_VERIFIED" ? "Khớp đoạn đường xác minh" : "Cận kề tuyến đường (Ứng viên)"}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Kiểm tra tầm nhìn: <strong>{camera.line_of_sight_verified ? "Đã kiểm chứng" : "Chưa kiểm chứng vật cản"}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 col-span-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Nguồn tọa độ: {camera.coordinate_source_url || "Sở GTVT TP.HCM (VDMS AjaxPro)"}</span>
              </div>
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
