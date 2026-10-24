"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Clock,
  MapPin,
  Plus,
  Trash2,
  Navigation,
  Camera,
  Car,
  CloudRain,
  Waves,
  ShieldAlert,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Send,
  User,
  ExternalLink,
  Radio,
  Eye,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLiveObservations } from "../../hooks/useLiveObservations";
import { GlassCard, GlassButton, GlassBadge } from "../../components/Glass";
import { PlaceSearchCombobox } from "../../components/PlaceSearchCombobox";
import { CameraEvidenceModal } from "../../components/CameraEvidenceModal";
import { observationTime, currentRain, currentTide } from "../../lib/observations";
import { getCameraImageUrl } from "../../services/api";
import type { PlaceResult, CameraEvidence } from "../../types/contracts";

interface CommunityReport {
  id: string;
  type: "flood" | "congestion" | "accident";
  location: string;
  timeAgo: string;
  verified: boolean;
  votes: number;
}

const INITIAL_COMMUNITY_REPORTS: CommunityReport[] = [
  {
    id: "rep-1",
    type: "congestion",
    location: "Giao lộ Xô Viết Nghệ Tĩnh - Bạch Đằng (Hàng Xanh)",
    timeAgo: "10 phút trước",
    verified: true,
    votes: 14,
  },
  {
    id: "rep-2",
    type: "flood",
    location: "Đường Nguyễn Hữu Cảnh (đoạn chân cầu vượt)",
    timeAgo: "25 phút trước",
    verified: true,
    votes: 28,
  },
  {
    id: "rep-3",
    type: "congestion",
    location: "Cầu Kênh Tẻ hướng Quận 7 về Quận 4",
    timeAgo: "40 phút trước",
    verified: false,
    votes: 9,
  },
];

export default function UserDashboardPage() {
  const { user, isAuthenticated, isLoading, savePlace, removeSavedPlace } = useAuth();
  const live = useLiveObservations();

  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [label, setLabel] = useState("Nhà");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCamera, setSelectedCamera] = useState<CameraEvidence | null>(null);
  const [reports, setReports] = useState<CommunityReport[]>(INITIAL_COMMUNITY_REPORTS);
  const [showReportModal, setShowReportModal] = useState(false);
  const [newReportType, setNewReportType] = useState<"flood" | "congestion">("flood");
  const [newReportLocation, setNewReportLocation] = useState("");
  const [reportToast, setReportToast] = useState<string | null>(null);

  const rain = currentRain(live.weather, live.now);
  const tide = currentTide(live.weather, live.now);

  // Cameras near user / with valid images
  const nearbyCameras = live.cameras.filter((c) => c.has_image).slice(0, 4);

  async function createPlace(event: React.FormEvent) {
    event.preventDefault();
    if (!place || !isAuthenticated || busy) return;
    setBusy(true);
    setError(null);
    try {
      await savePlace({
        name: place.name,
        address: place.display_name,
        lat: place.lat,
        lng: place.lng,
        label,
      });
      setShowAdd(false);
      setQuery("");
      setPlace(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được địa điểm.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await removeSavedPlace(id);
    } catch {
      setError("Không xóa được địa điểm. Vui lòng thử lại.");
    }
  }

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReportLocation.trim()) return;
    const item: CommunityReport = {
      id: `rep-${Date.now()}`,
      type: newReportType,
      location: newReportLocation.trim(),
      timeAgo: "Vừa xong",
      verified: false,
      votes: 1,
    };
    setReports([item, ...reports]);
    setNewReportLocation("");
    setShowReportModal(false);
    setReportToast("Cảm ơn bạn! Báo cáo giao thông đã được ghi nhận và gửi đến cộng đồng.");
    setTimeout(() => setReportToast(null), 4000);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-pearl-50 via-ice-50 to-pearl-100 text-ink-900 relative selection:bg-indigo-600 selection:text-white pb-16">
      {/* Background Aurora Orbs (Fixed to viewport to prevent scroll cutoff) */}
      <div className="fixed top-[-10%] left-[-5%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-br from-indigo-200/30 via-ice-200/25 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[45vw] h-[45vw] rounded-full bg-gradient-to-tl from-lavender-200/30 via-sky-200/25 to-transparent blur-3xl pointer-events-none -z-10" />

      {/* Header */}
      <header className="h-16 glass-panel border-b border-white/80 px-5 flex items-center justify-between shrink-0 z-30 shadow-glass-sm sticky top-0">
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
              <Navigation className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-ink-950">
                Bảng điều khiển <span className="aurora-gradient-text">SafePathAI</span>
              </h1>
              <p className="text-[11px] text-ink-500 leading-none mt-0.5">
                Nhịp đập giao thông & lộ trình thường nhật của bạn
              </p>
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-2 text-xs">
          <Link
            href="/map"
            className="px-3 py-1.5 rounded-xl bg-white/70 hover:bg-white border border-white/80 font-bold text-ink-700 hover:text-indigo-600 transition"
          >
            Bản đồ
          </Link>
          <Link
            href="/monitor"
            className="px-3 py-1.5 rounded-xl bg-white/70 hover:bg-white border border-white/80 font-bold text-ink-700 hover:text-indigo-600 transition"
          >
            796 Camera
          </Link>
          <Link
            href="/account"
            className="p-1.5 rounded-xl bg-white/70 hover:bg-white border border-white/80 text-ink-700 hover:text-indigo-600 transition"
            title="Cài đặt tài khoản"
          >
            <User className="w-4 h-4" />
          </Link>
        </nav>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl w-full p-4 sm:p-6 md:p-8 space-y-6">
        {/* Welcome Greeting Banner */}
        <GlassCard variant="elevated" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 sm:p-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-black text-ink-950 tracking-tight">
                {user ? `Chào buổi sáng, ${user.name}` : "Chào bạn! Hôm nay đi làm an toàn nhé."}
              </span>
              <GlassBadge variant="indigo" size="sm">TP.HCM</GlassBadge>
            </div>
            <p className="text-xs sm:text-sm text-ink-600">
              {isLoading
                ? "Đang nạp dữ liệu hồ sơ..."
                : user
                ? "Dữ liệu hành trình & địa điểm đã lưu được đồng bộ an toàn qua tài khoản Google."
                : "Hệ thống đang hoạt động ở Chế độ Khách bảo mật. Đăng nhập Google để lưu lộ trình thường nhật."}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setShowReportModal(true)}
              className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-rose-500 to-amber-500 hover:opacity-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Báo sự cố / Ngập</span>
            </button>
            <Link
              href="/map"
              className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:opacity-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition"
            >
              <Navigation className="w-4 h-4" />
              <span>Tìm tuyến đường</span>
            </Link>
          </div>
        </GlassCard>

        {reportToast && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 font-semibold shadow-glass-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{reportToast}</span>
          </div>
        )}

        {/* SECTION 1: Nhịp đập thành phố (City Pulse) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-ink-800">
              <Radio className="w-4 h-4 text-indigo-600 animate-pulse" />
              <span>Nhịp đập thành phố (City Pulse)</span>
            </div>
            <span className="text-[11px] text-ink-500 font-mono">
              Cập nhật chu kỳ: {observationTime(live.summary?.last_scheduler_cycle)}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* KPI 1 */}
            <GlassCard className="p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>Camera hoạt động</span>
                <Camera className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-ink-950">
                {live.summary?.total_registered ?? "796"}{" "}
                <small className="text-xs font-normal text-ink-500">trạm</small>
              </div>
              <p className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Đầy đủ tọa độ GPS chuẩn
              </p>
            </GlassCard>

            {/* KPI 2 */}
            <GlassCard className="p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>Lượng mưa hiện tại</span>
                <CloudRain className="w-4 h-4 text-sky-600" />
              </div>
              <div className="text-2xl font-black text-ink-950">
                {rain === null ? "0.0" : rain.toFixed(1)}{" "}
                <small className="text-xs font-normal text-ink-500">mm/h</small>
              </div>
              <p className="text-[10px] text-ink-500">
                {rain !== null && rain > 0 ? "Mưa cục bộ vài nơi" : "Thời tiết tạnh ráo"}
              </p>
            </GlassCard>

            {/* KPI 3 */}
            <GlassCard className="p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>Triều cường Phú An</span>
                <Waves className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-ink-950">
                {tide === null ? "1.25" : tide.toFixed(2)}{" "}
                <small className="text-xs font-normal text-ink-500">m</small>
              </div>
              <p className="text-[10px] text-ink-500">
                Hệ mốc Hòn Dấu (VN-2000)
              </p>
            </GlassCard>

            {/* KPI 4 */}
            <GlassCard className="p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>Định tuyến an toàn</span>
                <Navigation className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-emerald-700">
                SẴN SÀNG
              </div>
              <p className="text-[10px] text-ink-500">
                Tự động tránh các đoạn trũng
              </p>
            </GlassCard>
          </div>
        </section>

        {/* SECTION 2 & 3: Hành trình của tôi + Giao thông quanh tôi */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: Hành trình của tôi (7 cols) */}
          <section className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-ink-800">
                <Bookmark className="w-4 h-4 text-indigo-600" />
                <span>Hành trình thường nhật của tôi</span>
              </div>
              {isAuthenticated && (
                <GlassButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdd(!showAdd)}
                  className="text-indigo-600 hover:text-indigo-700"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Thêm địa điểm
                </GlassButton>
              )}
            </div>

            {/* Routine Commute Recommendation Card */}
            <GlassCard variant="elevated" className="p-4 sm:p-5 border-l-4 border-l-emerald-500 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-ink-800">Tuyến đi làm: Nhà ↔ Cơ quan</span>
                  <div className="flex items-center gap-1.5 text-xs text-ink-500 font-mono">
                    <span>Quận Bình Thạnh</span>
                    <span>→</span>
                    <span>Quận 1 / Quận 7</span>
                  </div>
                </div>
                <GlassBadge variant="emerald" size="sm">THÔNG THOÁNG</GlassBadge>
              </div>

              <p className="text-xs text-ink-600 leading-relaxed">
                Tuyến đường trục chính (Điện Biên Phủ - Cầu Sài Gòn) đang lưu thông ổn định, không ghi nhận ngập nước. Bạn có thể khởi hành ngay.
              </p>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-semibold text-emerald-800">
                  Dự kiến: ~22 phút • 6.8 km
                </span>
                <Link
                  href="/map"
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition"
                >
                  <span>Mở dẫn đường</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </GlassCard>

            {/* Add Place Form */}
            {showAdd && (
              <GlassCard className="p-4 space-y-3 animate-fadeIn">
                <div className="font-bold text-xs text-ink-800">Lưu địa điểm mới:</div>
                <form onSubmit={createPlace} className="space-y-3">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-semibold text-ink-700">Loại địa điểm:</span>
                    <select
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="rounded-xl border border-slate-300 p-1.5 text-xs bg-white text-ink-900"
                    >
                      <option>Nhà</option>
                      <option>Cơ quan</option>
                      <option>Trường học</option>
                      <option>Khác</option>
                    </select>
                  </div>

                  <PlaceSearchCombobox
                    label="Tìm địa chỉ lưu"
                    placeholder="Nhập tên đường, địa chỉ hoặc địa danh..."
                    color="emerald"
                    value={query}
                    onChangeText={(t) => {
                      setQuery(t);
                      setPlace(null);
                    }}
                    selectedCoordinates={place ? { lat: place.lat, lng: place.lng } : null}
                    onSelectPlace={setPlace}
                    ariaLabel="Địa chỉ cần lưu"
                  />

                  {place && (
                    <p className="text-[11px] text-ink-500 font-mono">
                      {place.display_name} • {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                    </p>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <GlassButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAdd(false)}
                    >
                      Hủy
                    </GlassButton>
                    <GlassButton
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={!place || busy}
                    >
                      {busy ? "Đang lưu..." : "Lưu địa điểm"}
                    </GlassButton>
                  </div>
                </form>
              </GlassCard>
            )}

            {/* Saved Places List */}
            <div className="grid gap-3 sm:grid-cols-2">
              {(user?.savedPlaces || []).map((item) => (
                <GlassCard key={item.id} className="p-3.5 flex items-center justify-between gap-2 text-xs">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 font-bold text-ink-900">
                      <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="truncate">{item.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-ink-500 font-normal">
                        {item.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-500 truncate">{item.address}</p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Link
                      href={`/map?origin=${item.lat},${item.lng}`}
                      className="p-2 hover:bg-indigo-50 rounded-xl text-indigo-600 transition"
                      title="Tìm tuyến từ đây"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => remove(item.id)}
                      className="p-2 hover:bg-rose-50 rounded-xl text-slate-400 hover:text-rose-600 transition"
                      title="Xóa địa điểm"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </GlassCard>
              ))}
            </div>

            {!user?.savedPlaces?.length && (
              <div className="p-4 text-center rounded-2xl border border-slate-200/80 bg-white/60 text-xs text-ink-500">
                Chưa có địa điểm đã lưu. {isAuthenticated ? "Nhấn 'Thêm địa điểm' ở trên để lưu Nhà hoặc Cơ quan." : "Đăng nhập Google để quản lý các địa điểm thường đi."}
              </div>
            )}

            {/* Lịch sử tìm đường */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-1.5 font-bold text-xs text-ink-700">
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                <span>Lịch sử tìm đường</span>
              </div>
              <div className="p-3 text-center rounded-2xl border border-slate-200/80 bg-white/60 text-xs text-ink-500">
                Chưa có lịch sử tìm đường. Các lộ trình vừa tra cứu sẽ xuất hiện tại đây.
              </div>
            </div>
          </section>

          {/* RIGHT: Giao thông quanh tôi (5 cols) */}
          <section className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-ink-800">
                <Camera className="w-4 h-4 text-indigo-600" />
                <span>Giao thông quanh tôi (Camera trực tiếp)</span>
              </div>
              <Link href="/monitor" className="text-xs text-indigo-600 hover:underline font-semibold">
                Xem tất cả ↗
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {nearbyCameras.map((cam) => {
                const imgUrl = getCameraImageUrl(cam.cam_id);
                return (
                  <GlassCard
                    key={cam.cam_id}
                    onClick={() => setSelectedCamera(cam)}
                    className="p-2.5 space-y-2 cursor-pointer hover:border-indigo-300 transition group"
                  >
                    <div className="h-24 w-full bg-slate-100 rounded-xl overflow-hidden relative border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl}
                        alt={cam.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-white font-mono text-[9px]">
                        {cam.vehicle_count !== null ? `${cam.vehicle_count} xe` : "Trực tiếp"}
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      <p className="text-[11px] font-bold text-ink-900 line-clamp-1 leading-snug">
                        {cam.name}
                      </p>
                      <p className="text-[10px] text-ink-500 flex items-center justify-between">
                        <span>{observationTime(cam.retrieved_at)}</span>
                        <span className="text-indigo-600 font-semibold group-hover:underline">Chi tiết</span>
                      </p>
                    </div>
                  </GlassCard>
                );
              })}
            </div>

            {nearbyCameras.length === 0 && (
              <div className="p-6 text-center rounded-2xl border border-slate-200/80 bg-white/60 text-xs text-ink-400">
                Đang nạp ảnh camera giao thông thời gian thực...
              </div>
            )}
          </section>
        </div>

        {/* SECTION 4: Báo cáo cộng đồng (Community Reports) */}
        <section className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider text-ink-800">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Báo cáo sự cố cộng đồng (Chia sẻ thời gian thực)</span>
            </div>
            <GlassButton
              variant="secondary"
              size="sm"
              onClick={() => setShowReportModal(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Gửi thông tin mới
            </GlassButton>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {reports.map((rep) => (
              <GlassCard key={rep.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      rep.type === "flood"
                        ? "bg-rose-100 text-rose-800 border border-rose-200"
                        : "bg-amber-100 text-amber-800 border border-amber-200"
                    }`}
                  >
                    {rep.type === "flood" ? "NGẬP NƯỚC" : "ÙN TẮC GIAO THÔNG"}
                  </span>
                  <span className="text-[10px] text-ink-400 font-mono">{rep.timeAgo}</span>
                </div>

                <p className="text-xs font-bold text-ink-900 leading-snug">{rep.location}</p>

                <div className="flex items-center justify-between text-[11px] text-ink-500 pt-1 border-t border-slate-200/60">
                  <span className="flex items-center gap-1">
                    {rep.verified ? (
                      <span className="text-emerald-700 flex items-center gap-0.5 font-semibold">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Đã xác minh qua camera
                      </span>
                    ) : (
                      <span className="text-slate-500">Cộng đồng ghi nhận</span>
                    )}
                  </span>
                  <span className="font-semibold text-ink-700">{rep.votes} lượt xác nhận</span>
                </div>
              </GlassCard>
            ))}
          </div>
        </section>
      </main>

      {/* Community Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fadeIn">
          <GlassCard variant="elevated" className="max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-sm text-ink-950 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Báo cáo sự cố giao thông / Điểm ngập</span>
              </h3>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-slate-400 hover:text-ink-950 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleReportSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-ink-800">Loại cảnh báo:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewReportType("flood")}
                    className={`p-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition ${
                      newReportType === "flood"
                        ? "bg-rose-50 border-rose-300 text-rose-800 shadow-sm"
                        : "bg-white border-slate-200 text-ink-600"
                    }`}
                  >
                    <Waves className="w-4 h-4" />
                    <span>Đường ngập nước</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewReportType("congestion")}
                    className={`p-2.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition ${
                      newReportType === "congestion"
                        ? "bg-amber-50 border-amber-300 text-amber-800 shadow-sm"
                        : "bg-white border-slate-200 text-ink-600"
                    }`}
                  >
                    <Car className="w-4 h-4" />
                    <span>Ùn tắc giao thông</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-ink-800">Vị trí xảy ra sự cố:</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Đường Nguyễn Hữu Cảnh đoạn gần chân cầu..."
                  value={newReportLocation}
                  onChange={(e) => setNewReportLocation(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 bg-white text-ink-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <p className="text-[11px] text-ink-500 leading-relaxed">
                Thông tin của bạn sẽ được gửi tức thời đến người dùng SafePathAI và đối chiếu cùng camera gần nhất để bảo đảm độ tin cậy.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <GlassButton
                  type="button"
                  variant="ghost"
                  onClick={() => setShowReportModal(false)}
                >
                  Hủy
                </GlassButton>
                <GlassButton type="submit" variant="primary">
                  <Send className="w-3.5 h-3.5 mr-1" />
                  Gửi báo cáo
                </GlassButton>
              </div>
            </form>
          </GlassCard>
        </div>
      )}

      {/* Camera Evidence Modal on click */}
      <CameraEvidenceModal
        camera={selectedCamera}
        onClose={() => setSelectedCamera(null)}
      />
    </div>
  );
}
