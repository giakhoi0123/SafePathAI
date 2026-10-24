"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchCameras, fetchCameraSummary, getCameraImageUrl } from "../../services/api";
import { CameraEvidence, CameraSummary, RiskLevel } from "../../types/contracts";
import { CameraEvidenceModal } from "../../components/CameraEvidenceModal";
import {
  Navigation,
  Camera,
  Layers,
  MapPin,
  Search,
  Filter,
  Eye,
  Droplets,
  Car,
  ShieldCheck,
  Radio,
  ArrowLeft,
  LayoutGrid,
  Sparkles,
} from "lucide-react";
import { GlassCard, GlassBadge, GlassButton, GlassInput } from "../../components/Glass";

export default function CameraMonitorPage() {
  const [cameras, setCameras] = useState<CameraEvidence[]>([]);
  const [summary, setSummary] = useState<CameraSummary | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraEvidence | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [districtFilter, setDistrictFilter] = useState<string>("ALL");
  const [onlyWithImage, setOnlyWithImage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadCameras = useCallback(async () => {
    setIsLoading(true);
    try {
      const [cameraList, summaryData] = await Promise.all([
        fetchCameras(),
        fetchCameraSummary().catch(() => null),
      ]);
      setCameras(cameraList);
      if (summaryData) setSummary(summaryData);
    } catch (e) {
      console.warn("Failed to load cameras for monitor:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCameras();
    const interval = setInterval(async () => {
      try {
        const sum = await fetchCameraSummary();
        setSummary(sum);
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [loadCameras]);

  const districts = Array.from(
    new Set(cameras.map((c) => c.district).filter(Boolean))
  ).sort() as string[];

  const filteredCameras = cameras.filter((cam) => {
    if (onlyWithImage && !cam.has_image) return false;
    if (districtFilter !== "ALL" && cam.district !== districtFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = cam.name.toLowerCase().includes(q);
      const matchCode = (cam.code || "").toLowerCase().includes(q);
      const matchDistrict = (cam.district || "").toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchDistrict) return false;
    }
    return true;
  });

  return (
    <div className="spatial-aux flex flex-col min-h-screen bg-pearl-100 text-ink-900 relative selection:bg-indigo-600 selection:text-white">
      {/* Background aurora mist */}
      <div className="absolute top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-gradient-to-br from-indigo-200/40 via-ice-200/30 to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-tl from-lavender-200/40 via-soft-cyan/30 to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="h-14 glass-panel border-b border-white/80 px-5 flex items-center justify-between shrink-0 z-30 shadow-glass-sm sticky top-0">
        <div className="flex items-center gap-3">
          <Link
            href="/map"
            className="p-2 bg-white/80 hover:bg-white rounded-2xl border border-white/90 text-ink-700 hover:text-ink-950 transition shadow-glass-sm"
            title="Quay lại Bản đồ"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 rounded-2xl shadow-md text-white">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-ink-950">
                Trung tâm Giám sát Camera <span className="aurora-gradient-text">TP.HCM</span>
              </h1>
              <p className="text-[11px] text-ink-500 leading-none mt-0.5">
                Quan trắc hình ảnh thời gian thực & Thị giác máy tính
              </p>
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <div className="flex items-center gap-2">
          <Link
            href="/map"
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-ink-950 hover:bg-white/70 transition"
          >
            Bản đồ
          </Link>
          <Link
            href="/monitor"
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-white/90 text-indigo-700 shadow-glass-sm border border-indigo-200/80"
          >
            Giám sát camera
          </Link>
          <Link
            href="/dashboard"
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-ink-950 hover:bg-white/70 transition"
          >
            Bảng tin
          </Link>
          <Link
            href="/account"
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-ink-950 hover:bg-white/70 transition"
          >
            Tài khoản
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-5 max-w-7xl mx-auto w-full space-y-5">
        {/* Real Network Telemetry Summary */}
        {summary && (
          <div data-testid="monitor-telemetry-summary" className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="glass-panel rounded-2xl p-3 border border-white/90 shadow-glass-sm flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-ink-500 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-indigo-600" />
                Tổng Camera Đăng Ký
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-black text-ink-950 font-mono">{summary.total_registered}</span>
                <span className="text-[10px] font-medium text-emerald-600">{summary.valid_gps_count} có tọa độ</span>
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-3 border border-white/90 shadow-glass-sm flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-ink-500 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-blue-600" />
                Thăm Dò Scheduler
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-black text-ink-950 font-mono">{summary.checked_count}</span>
                <span className="text-[10px] font-medium text-ink-500">/ {summary.total_registered} camera</span>
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-3 border border-white/90 shadow-glass-sm flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-ink-500 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-cyan-600" />
                Ảnh Nhận Gần Đây
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-black text-cyan-700 font-mono">{summary.valid_images_count}</span>
                <span className="text-[10px] font-medium text-ink-500">
                  {summary.circuit_breaker_open ? "Circuit Open" : "trong 15 phút"}
                </span>
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-3 border border-white/90 shadow-glass-sm flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-ink-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Đã Phân Tích AI
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-black text-amber-700 font-mono">{summary.analyzed_count}</span>
                <span className="text-[10px] font-medium text-ink-500">kết quả từ backend</span>
              </div>
            </div>
          </div>
        )}

        {/* Filter Toolbar */}
        <div className="glass-panel rounded-3xl p-4 border border-white/90 shadow-glass space-y-3">
          <div className="flex flex-col md:flex-row items-center gap-3 justify-between">
            <div className="w-full md:w-80">
              <GlassInput
                placeholder="Tìm camera theo tên, mã hoặc quận..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClear={() => setSearchQuery("")}
                leftIcon={<Search className="w-4 h-4" />}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              {/* District Filter Dropdown */}
              <select
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                className="px-3 py-2 rounded-2xl bg-white/85 text-ink-800 text-xs font-semibold border border-white/90 shadow-glass-sm outline-none cursor-pointer"
              >
                <option value="ALL">Tất cả quận / huyện ({cameras.length})</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              {/* Only with image toggle */}
              <button
                type="button"
                onClick={() => setOnlyWithImage((v) => !v)}
                className={`px-3 py-2 rounded-2xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 ${
                  onlyWithImage
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm"
                    : "bg-white/85 border-white/90 text-ink-700 hover:bg-white"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Chỉ hiện có ảnh thực</span>
              </button>

              <GlassBadge variant="indigo" size="md">
                {filteredCameras.length} camera
              </GlassBadge>
            </div>
          </div>
        </div>

        {/* Camera Grid View */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16 space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium text-ink-600">Đang tải danh mục camera TP.HCM...</p>
          </div>
        ) : filteredCameras.length === 0 ? (
          <div className="glass-panel rounded-3xl p-12 text-center border border-white/90 shadow-glass space-y-2">
            <Camera className="w-10 h-10 text-ink-400 mx-auto" />
            <h3 className="text-sm font-bold text-ink-800">Không tìm thấy camera phù hợp</h3>
            <p className="text-xs text-ink-500">Hãy thử đổi từ khóa tìm kiếm hoặc chọn quận khác.</p>
          </div>
        ) : (
          <div data-testid="camera-monitor-grid" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredCameras.map((cam) => {
              const imageUrl = getCameraImageUrl(cam.cam_id);

              return (
                <div
                  key={cam.cam_id}
                  onClick={() => setSelectedCamera(cam)}
                  className="glass-panel-elevated rounded-3xl overflow-hidden border border-white/90 shadow-glass hover:shadow-glass-elevated hover:border-white transition-all duration-200 cursor-pointer flex flex-col group"
                >
                  {/* Camera Snapshot / Placeholder View */}
                  <div className="relative aspect-video bg-slate-900/10 overflow-hidden flex items-center justify-center">
                    {cam.has_image ? (
                      <img
                        src={imageUrl}
                        alt={cam.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-4 text-center text-ink-400 space-y-1">
                        <Camera className="w-6 h-6 stroke-1" />
                        <span className="text-[10px] font-medium">Chưa có ảnh trực tiếp</span>
                      </div>
                    )}

                    {/* Top camera code & enhancement badge */}
                    <div className="absolute top-2 left-2 flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-900/70 text-white backdrop-blur-md">
                        {cam.code || "CAM"}
                      </span>
                      {cam.enhancement_applied && (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-600/85 text-white backdrop-blur-md flex items-center gap-0.5" title="Hỗ trợ AI tăng cường chi tiết">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>AI+</span>
                        </span>
                      )}
                    </div>

                    {/* Image status pill */}
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      {cam.image_quality && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold backdrop-blur-md ${
                          cam.image_quality.quality_status === "HIGH_QUALITY" || cam.image_quality.quality_status === "ACCEPTABLE"
                            ? "bg-slate-900/60 text-slate-200"
                            : "bg-amber-500/85 text-white"
                        }`}>
                          {cam.image_quality.quality_status === "HIGH_QUALITY" ? "Chuẩn" :
                           cam.image_quality.quality_status === "ACCEPTABLE" ? "Ổn" : "Kém"}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md ${
                          cam.has_image
                            ? "bg-emerald-500/80 text-white"
                            : "bg-slate-700/80 text-slate-200"
                        }`}
                      >
                        {cam.has_image ? "CÓ ẢNH" : "CHƯA CÓ ẢNH"}
                      </span>
                    </div>
                  </div>

                  {/* Camera Meta Body */}
                  <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                      <h4 className="text-xs font-bold text-ink-950 line-clamp-1 group-hover:text-indigo-600 transition">
                        {cam.name}
                      </h4>
                      <p className="text-[11px] text-ink-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-ink-400 shrink-0" />
                        <span>{cam.district || "TP. Hồ Chí Minh"}</span>
                      </p>
                    </div>

                    {/* Computer Vision Metrics */}
                    <div className="pt-2 border-t border-slate-200/70 grid grid-cols-2 gap-1 text-[10px]">
                      <div className="flex items-center gap-1 text-ink-600">
                        <Car className="w-3 h-3 text-indigo-500" />
                        <span>
                          {cam.vehicle_count !== null && cam.vehicle_count !== undefined
                            ? `${cam.vehicle_count} xe`
                            : "Chưa phân tích"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-ink-600">
                        <Droplets className="w-3 h-3 text-cyan-500" />
                        <span>
                          {cam.flood_ratio !== null && cam.flood_ratio !== undefined
                            ? `${Math.round(cam.flood_ratio * 100)}% ngập`
                            : "Chưa có ảnh"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Camera Evidence Modal */}
      <CameraEvidenceModal
        camera={selectedCamera}
        onClose={() => setSelectedCamera(null)}
      />
    </div>
  );
}
