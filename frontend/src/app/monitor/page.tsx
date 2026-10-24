"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchCameras, fetchCameraSummary, getCameraImageUrl, registerActiveViewedCameras } from "../../services/api";
import { CameraEvidence, CameraSummary } from "../../types/contracts";
import { CameraEvidenceModal } from "../../components/CameraEvidenceModal";
import {
  Navigation,
  Camera,
  MapPin,
  Search,
  Eye,
  Droplets,
  Car,
  Radio,
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Layers,
  User,
  CheckCircle,
  Clock,
} from "lucide-react";
import { GlassBadge, GlassInput } from "../../components/Glass";

export default function CameraMonitorPage() {
  const [cameras, setCameras] = useState<CameraEvidence[]>([]);
  const [summary, setSummary] = useState<CameraSummary | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraEvidence | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [districtFilter, setDistrictFilter] = useState<string>("ALL");
  const [onlyWithImage, setOnlyWithImage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const [cameraList, summaryData] = await Promise.all([
        fetchCameras(),
        fetchCameraSummary().catch(() => null),
      ]);
      setCameras(cameraList);
      if (summaryData) setSummary(summaryData);
    } catch (e) {
      console.warn("Refresh failed:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

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

  const visibleTopCamIds = filteredCameras.slice(0, 12).map((c) => c.cam_id).join(",");
  useEffect(() => {
    if (!visibleTopCamIds) return;
    const topIds = visibleTopCamIds.split(",");
    registerActiveViewedCameras(topIds, 90).catch(() => {});
    const interval = setInterval(() => {
      registerActiveViewedCameras(topIds, 90).catch(() => {});
    }, 45000);
    return () => clearInterval(interval);
  }, [visibleTopCamIds]);

  return (
    <div className="spatial-aux flex flex-col min-h-screen text-ink-900 relative selection:bg-indigo-600 selection:text-white pb-16">
      {/* Background aurora mist */}
      <div className="fixed top-[-10%] left-[-5%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-br from-indigo-200/35 via-ice-200/25 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[45vw] h-[45vw] rounded-full bg-gradient-to-tl from-lavender-200/35 via-sky-200/25 to-transparent blur-3xl pointer-events-none -z-10" />

      {/* Floating Header Capsule */}
      <header className="mx-4 sm:mx-6 md:mx-auto max-w-7xl mt-4 h-14 rounded-full bg-white/85 backdrop-blur-2xl border border-white/95 px-4 sm:px-6 flex items-center justify-between shrink-0 z-30 shadow-glass-sm sticky top-4">
        <div className="flex items-center gap-3">
          <Link
            href="/map"
            className="p-2 bg-white/80 hover:bg-white rounded-full border border-white/90 text-ink-700 hover:text-ink-950 transition shadow-glass-sm"
            title="Quay lại Bản đồ"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 rounded-2xl shadow-md shadow-indigo-500/20 text-white">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-black tracking-tight text-ink-950">
                  Trung tâm Giám sát Camera <span className="aurora-gradient-text">TP.HCM</span>
                </h1>
                <span className="hidden sm:inline-block text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/70 shadow-sm">
                  796 MẮT THẦN
                </span>
              </div>
              <p className="hidden md:block text-[11px] text-ink-500 leading-none mt-0.5 font-medium">
                Quan trắc hình ảnh thời gian thực & phân tích phương tiện AI
              </p>
            </div>
          </div>
        </div>

        {/* Navigation links matching /map */}
        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/map"
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-indigo-600 hover:bg-white/80 transition"
          >
            Bản đồ
          </Link>
          <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-white/95 text-indigo-700 shadow-glass-sm border border-indigo-200/80">
            Giám sát camera
          </span>
          <Link
            href="/dashboard"
            className="hidden sm:inline-block px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-indigo-600 hover:bg-white/80 transition"
          >
            Bảng tin
          </Link>
          <Link
            href="/account"
            className="p-1.5 sm:px-3 sm:py-1.5 rounded-full bg-white/80 hover:bg-white border border-white/90 text-ink-700 hover:text-indigo-600 shadow-glass-sm transition text-xs font-bold flex items-center gap-1.5"
            title="Tài khoản"
          >
            <User className="w-4 h-4 text-indigo-600" />
            <span className="hidden md:inline">Tài khoản</span>
          </Link>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-6 mt-2">
        {/* Real Network Telemetry Summary (4 Glass Metrics) */}
        {summary && (
          <div data-testid="monitor-telemetry-summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Metric 1: Camera đã đăng ký */}
            <div className="liquid-glass-surface rounded-3xl p-4 sm:p-5 flex flex-col justify-between space-y-3 group hover:border-indigo-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink-700">Tổng camera đăng ký</span>
                <div className="p-2.5 rounded-2xl bg-indigo-50/90 border border-indigo-100 text-indigo-600 shadow-glass-sm group-hover:scale-105 transition-transform">
                  <Camera className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-black text-ink-950 font-mono tracking-tight">
                  {summary.total_registered}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{summary.valid_gps_count} camera có tọa độ GPS</span>
                </div>
              </div>
            </div>

            {/* Metric 2: Camera đã kiểm tra trong chu kỳ 30 phút */}
            <div className="liquid-glass-surface rounded-3xl p-4 sm:p-5 flex flex-col justify-between space-y-3 group hover:border-blue-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink-700">Đã rà soát chu kỳ này</span>
                <div className="p-2.5 rounded-2xl bg-blue-50/90 border border-blue-100 text-blue-600 shadow-glass-sm group-hover:scale-105 transition-transform">
                  <Radio className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-black text-ink-950 font-mono tracking-tight">
                  {summary.cycle_checked_count ?? summary.checked_count}
                </div>
                <div className="mt-1 text-[11px] text-ink-500 font-medium">
                  {summary.cycle_pending_count !== undefined && summary.cycle_pending_count !== null
                    ? `Chu kỳ 30 phút • Còn chờ ${summary.cycle_pending_count} camera`
                    : `trên tổng số ${summary.total_registered} camera toàn thành phố`}
                </div>
              </div>
            </div>

            {/* Metric 3: Camera có ảnh mới gần đây */}
            <div className="liquid-glass-surface rounded-3xl p-4 sm:p-5 flex flex-col justify-between space-y-3 group hover:border-cyan-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink-700">Camera có ảnh mới gần đây</span>
                <div className="p-2.5 rounded-2xl bg-cyan-50/90 border border-cyan-100 text-cyan-600 shadow-glass-sm group-hover:scale-105 transition-transform">
                  <Eye className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-black text-cyan-800 font-mono tracking-tight">
                  {summary.valid_images_count}
                </div>
                <div className="mt-1 text-[11px] text-ink-500 font-medium">
                  {summary.circuit_breaker_open ? "Đang điều tiết tải kết nối" : "snapshot hợp lệ trong chu kỳ 30 phút"}
                </div>
              </div>
            </div>

            {/* Metric 4: Ảnh đã được AI phân tích */}
            <div className="liquid-glass-surface rounded-3xl p-4 sm:p-5 flex flex-col justify-between space-y-3 group hover:border-amber-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink-700">Ảnh đã được AI phân tích</span>
                <div className="p-2.5 rounded-2xl bg-amber-50/90 border border-amber-100 text-amber-600 shadow-glass-sm group-hover:scale-105 transition-transform">
                  <Sparkles className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl sm:text-3xl font-black text-amber-800 font-mono tracking-tight">
                  {summary.analyzed_count}
                </div>
                <div className="mt-1 text-[11px] text-ink-500 font-medium">
                  nhận diện phương tiện & kiểm tra ngập
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Friendly Cycle Status Banner */}
        {summary && summary.last_scheduler_cycle && (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white/70 border border-white/90 text-xs text-ink-600 shadow-glass-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              <span>
                Cập nhật gần nhất: <strong>{new Date(summary.last_scheduler_cycle).toLocaleTimeString("vi-VN")}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-ink-500">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Lượt cập nhật xoay vòng toàn mạng lưới: <strong>Mỗi 30 phút</strong></span>
            </div>
          </div>
        )}

        {/* Filter Toolbar (Floating Glass Surface) */}
        <div className="liquid-glass-surface rounded-3xl p-4 sm:p-5 border border-white/95 shadow-glass space-y-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 justify-between">
            {/* Search input */}
            <div className="w-full md:w-96">
              <GlassInput
                placeholder="Tìm camera theo tên đường, mã hoặc quận..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClear={() => setSearchQuery("")}
                leftIcon={<Search className="w-4 h-4" />}
              />
            </div>

            {/* Filters and Actions */}
            <div className="flex flex-wrap items-center gap-2.5 justify-start md:justify-end">
              {/* District Filter Dropdown */}
              <select
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                aria-label="Lọc theo quận huyện"
                className="px-3.5 py-2.5 rounded-2xl bg-white/90 hover:bg-white text-ink-900 text-xs font-bold border border-indigo-100/90 shadow-glass-sm outline-none cursor-pointer focus:ring-4 focus:ring-indigo-400/20 transition"
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
                className={`px-3.5 py-2.5 rounded-2xl text-xs font-bold border transition-all duration-200 cursor-pointer flex items-center gap-1.5 shadow-glass-sm select-none ${
                  onlyWithImage
                    ? "bg-indigo-50/95 border-indigo-300 text-indigo-700 shadow-sm ring-2 ring-indigo-400/20"
                    : "bg-white/90 border-white/95 text-ink-700 hover:text-ink-950 hover:bg-white"
                }`}
              >
                <Eye className="w-3.5 h-3.5 text-indigo-600" />
                <span>Chỉ hiện có ảnh thực</span>
              </button>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="p-2.5 rounded-2xl bg-white/90 hover:bg-white border border-white/95 text-ink-700 hover:text-indigo-600 shadow-glass-sm transition cursor-pointer disabled:opacity-50"
                title="Làm mới danh sách camera"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-indigo-600" : ""}`} />
              </button>

              <GlassBadge variant="indigo" size="md">
                {filteredCameras.length} camera
              </GlassBadge>
            </div>
          </div>
        </div>

        {/* Camera Gallery Grid View */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-20 space-y-3">
            <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-bold text-ink-700">Đang nạp thư viện camera TP.HCM...</p>
          </div>
        ) : filteredCameras.length === 0 ? (
          <div className="liquid-glass-surface rounded-3xl p-16 text-center border border-white/95 shadow-glass space-y-3">
            <div className="w-12 h-12 rounded-3xl bg-indigo-50 border border-indigo-100/80 text-indigo-600 flex items-center justify-center mx-auto shadow-sm">
              <Camera className="w-6 h-6 stroke-1.5" />
            </div>
            <h3 className="text-sm font-bold text-ink-950">Không tìm thấy camera phù hợp</h3>
            <p className="text-xs text-ink-500 max-w-sm mx-auto">
              Hãy thử đổi từ khóa tìm kiếm hoặc chọn &quot;Tất cả quận / huyện&quot; để hiển thị toàn bộ 796 camera.
            </p>
          </div>
        ) : (
          <div
            data-testid="camera-monitor-grid"
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5"
          >
            {filteredCameras.map((cam) => {
              const imageUrl = getCameraImageUrl(cam.cam_id);

              return (
                <div
                  key={cam.cam_id}
                  data-testid="camera-card"
                  onClick={() => setSelectedCamera(cam)}
                  className="group relative rounded-3xl overflow-hidden border border-white/95 bg-gradient-to-b from-white/95 via-white/90 to-ice-50/40 hover:bg-white shadow-glass hover:shadow-glass-elevated hover:border-white transition-all duration-300 hover:-translate-y-1 cursor-pointer flex flex-col"
                >
                  {/* Camera Snapshot / Placeholder View */}
                  <div className="relative aspect-video bg-gradient-to-br from-slate-100 to-indigo-50/40 overflow-hidden flex items-center justify-center border-b border-slate-100/80">
                    {cam.has_image ? (
                      <img
                        src={imageUrl}
                        alt={cam.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-out"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-4 text-center text-ink-400 space-y-1.5">
                        <div className="p-2 rounded-2xl bg-white/80 border border-slate-200/60 shadow-glass-sm text-ink-400">
                          <Camera className="w-5 h-5 stroke-1.5" />
                        </div>
                        <span className="text-[11px] font-semibold text-ink-500">Chưa có ảnh trực tiếp</span>
                      </div>
                    )}

                    {/* Hover CTA Pill */}
                    <div className="absolute inset-0 bg-indigo-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
                      <span className="px-3.5 py-1.5 rounded-full bg-white/95 text-indigo-700 font-bold text-xs shadow-md border border-white/90 flex items-center gap-1.5 transform translate-y-2 group-hover:translate-y-0 transition-transform">
                        <Eye className="w-3.5 h-3.5" />
                        <span>Xem chi tiết</span>
                      </span>
                    </div>

                    {/* Top camera code & enhancement badge */}
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/95 text-indigo-950 border border-white/90 backdrop-blur-md shadow-sm">
                        {cam.code || "CAM"}
                      </span>
                      {cam.enhancement_applied && (
                        <span
                          className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-gradient-to-r from-indigo-600 to-sky-500 text-white backdrop-blur-md flex items-center gap-0.5 shadow-sm"
                          title="Hỗ trợ AI tăng cường chi tiết"
                        >
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>AI+</span>
                        </span>
                      )}
                    </div>

                    {/* Image status pill */}
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md border shadow-sm flex items-center gap-1 ${
                          cam.has_image
                            ? "bg-emerald-50/95 text-emerald-800 border-emerald-200"
                            : "bg-slate-100/90 text-ink-600 border-slate-200"
                        }`}
                      >
                        {cam.has_image && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                        <span>{cam.has_image ? "CÓ ẢNH" : "CHƯA CÓ ẢNH"}</span>
                      </span>
                    </div>
                  </div>

                  {/* Camera Meta Body */}
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-ink-950 line-clamp-1 group-hover:text-indigo-600 transition">
                        {cam.name}
                      </h4>
                      <p className="text-[11px] text-ink-500 font-medium flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3 text-indigo-500 shrink-0" />
                        <span className="truncate">{cam.district || "TP. Hồ Chí Minh"}</span>
                      </p>
                    </div>

                    {/* AI Vehicle & Water Observations */}
                    <div className="pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5 text-ink-700">
                        <Car className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span className="font-semibold">
                          {cam.vehicle_count !== null && cam.vehicle_count !== undefined
                            ? `${cam.vehicle_count} xe`
                            : "Chưa phân tích"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-ink-700">
                        <Droplets className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                        <span className="font-semibold">
                          {cam.flood_ratio !== null && cam.flood_ratio !== undefined
                            ? `${Math.round(cam.flood_ratio * 100)}% ngập`
                            : cam.has_image
                            ? "Mặt đường khô"
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

      {/* Truthful Camera Evidence Modal */}
      <CameraEvidenceModal
        camera={selectedCamera}
        onClose={() => setSelectedCamera(null)}
      />
    </div>
  );
}
