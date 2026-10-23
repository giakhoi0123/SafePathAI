"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import {
  Navigation,
  Bookmark,
  Clock,
  AlertTriangle,
  Send,
  MapPin,
  ArrowRight,
  Car,
  Home,
  Building,
  GraduationCap,
  Plus,
  Trash2,
  CheckCircle,
  ArrowLeft,
} from "lucide-react";
import { GlassCard, GlassBadge, GlassButton, GlassInput } from "../../components/Glass";

export default function UserDashboardPage() {
  const { user, isAuthenticated, loginWithGoogle, savePlace, removeSavedPlace } = useAuth();
  const [reportRoad, setReportRoad] = useState("");
  const [reportDistrict, setReportDistrict] = useState("Quận 1");
  const [reportDesc, setReportDesc] = useState("");
  const [reportLevel, setReportLevel] = useState("MODERATE");
  const [reportSubmitted, setReportSubmitted] = useState(false);

  const [newPlaceLabel, setNewPlaceLabel] = useState<"Nhà" | "Cơ quan" | "Trường học" | "Khác">("Nhà");
  const [newPlaceName, setNewPlaceName] = useState("");
  const [showAddPlace, setShowAddPlace] = useState(false);

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportRoad.trim()) return;
    setReportSubmitted(true);
    setTimeout(() => {
      setReportRoad("");
      setReportDesc("");
      setReportSubmitted(false);
    }, 3000);
  };

  const handleCreatePlace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaceName.trim()) return;
    savePlace({
      label: newPlaceLabel,
      name: newPlaceName,
      address: newPlaceName,
      lat: 10.7769,
      lng: 106.7009,
    });
    setNewPlaceName("");
    setShowAddPlace(false);
  };

  const getLabelIcon = (label: string) => {
    switch (label) {
      case "Nhà":
        return <Home className="w-4 h-4 text-emerald-600" />;
      case "Cơ quan":
        return <Building className="w-4 h-4 text-indigo-600" />;
      case "Trường học":
        return <GraduationCap className="w-4 h-4 text-amber-600" />;
      default:
        return <MapPin className="w-4 h-4 text-slate-600" />;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-pearl-100 text-ink-900 relative selection:bg-indigo-600 selection:text-white">
      {/* Background aurora mist */}
      <div className="absolute top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-gradient-to-br from-indigo-200/40 via-ice-200/30 to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-tl from-lavender-200/40 via-soft-cyan/30 to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="h-14 glass-panel border-b border-white/80 px-5 flex items-center justify-between shrink-0 z-30 shadow-glass-sm sticky top-0">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 bg-white/80 hover:bg-white rounded-2xl border border-white/90 text-ink-700 hover:text-ink-950 transition shadow-glass-sm"
            title="Quay lại Bản đồ"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 rounded-2xl shadow-md text-white">
              <Bookmark className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-ink-950">
                Bảng tin & Lộ trình <span className="aurora-gradient-text">SafePathAI</span>
              </h1>
              <p className="text-[11px] text-ink-500 leading-none mt-0.5">
                Địa điểm đã lưu, lịch sử di chuyển & Phản ánh sự cố
              </p>
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-ink-950 hover:bg-white/70 transition"
          >
            Bản đồ
          </Link>
          <Link
            href="/monitor"
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-ink-950 hover:bg-white/70 transition"
          >
            Giám sát camera
          </Link>
          <Link
            href="/dashboard"
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-white/90 text-indigo-700 shadow-glass-sm border border-indigo-200/80"
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

      {/* Main Workspace */}
      <main className="flex-1 p-5 max-w-6xl mx-auto w-full space-y-6">
        {/* Welcome Banner */}
        <div className="glass-panel-elevated rounded-3xl p-6 border border-white/95 shadow-glass-elevated flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-black text-ink-950">
              Xin chào, {user ? user.name : "Người dùng SafePathAI"}!
            </h2>
            <p className="text-xs text-ink-600">
              {user
                ? "Dữ liệu chuyến đi và địa điểm của bạn được đồng bộ tự động."
                : "Bạn đang sử dụng hồ sơ khách. Đăng nhập để lưu địa điểm yêu thích và lịch sử tuyến."}
            </p>
          </div>
          {!isAuthenticated && (
            <Link href="/account">
              <GlassButton variant="primary">
                Đăng nhập tài khoản
              </GlassButton>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Saved Places & History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Saved Places Card */}
            <GlassCard variant="elevated" className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200/70 pb-3">
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-ink-800">
                  <Bookmark className="w-4 h-4 text-indigo-600" />
                  <span>Địa điểm yêu thích (1-Click tìm đường)</span>
                </div>
                {user && (
                  <button
                    type="button"
                    onClick={() => setShowAddPlace((v) => !v)}
                    className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm địa điểm</span>
                  </button>
                )}
              </div>

              {/* Add Place Inline Form */}
              {showAddPlace && (
                <form onSubmit={handleCreatePlace} className="p-3 bg-white/70 rounded-2xl border border-slate-200/80 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={newPlaceLabel}
                      onChange={(e) => setNewPlaceLabel(e.target.value as any)}
                      className="px-3 py-2 rounded-xl bg-white text-xs font-semibold border border-slate-200"
                    >
                      <option value="Nhà">Nhà</option>
                      <option value="Cơ quan">Cơ quan</option>
                      <option value="Trường học">Trường học</option>
                      <option value="Khác">Khác</option>
                    </select>
                    <div className="sm:col-span-2">
                      <GlassInput
                        placeholder="Tên địa chỉ (ví dụ: Chợ Bến Thành, Quận 1)..."
                        value={newPlaceName}
                        onChange={(e) => setNewPlaceName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <GlassButton size="sm" variant="ghost" onClick={() => setShowAddPlace(false)}>
                      Hủy
                    </GlassButton>
                    <GlassButton size="sm" variant="primary" type="submit">
                      Lưu lại
                    </GlassButton>
                  </div>
                </form>
              )}

              {/* Saved Places List */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(user?.savedPlaces || [
                  { id: "def_1", label: "Nhà", name: "Chợ Bến Thành (Quận 1)", lat: 10.7725, lng: 106.6980 },
                  { id: "def_2", label: "Cơ quan", name: "Landmark 81 (Bình Thạnh)", lat: 10.7950, lng: 106.7218 },
                ]).map((place) => (
                  <div
                    key={place.id}
                    className="p-3.5 rounded-2xl bg-white/80 border border-slate-200/80 shadow-glass-sm flex items-center justify-between gap-3 group hover:border-indigo-200 hover:bg-white transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                        {getLabelIcon(place.label)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-ink-950 flex items-center gap-1.5">
                          <span>{place.label}</span>
                        </div>
                        <p className="text-[11px] text-ink-500 line-clamp-1">{place.name}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Link
                        href={`/?origin=${place.lat},${place.lng}`}
                        className="p-2 rounded-xl text-indigo-600 hover:bg-indigo-50 transition"
                        title="Dẫn đường từ đây"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                      {user && (
                        <button
                          type="button"
                          onClick={() => removeSavedPlace(place.id)}
                          className="p-2 rounded-xl text-ink-400 hover:text-rose-600 transition"
                          title="Xóa"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Travel History Card */}
            <GlassCard variant="elevated" className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200/70 pb-3">
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-ink-800">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <span>Lịch sử các tuyến đã tìm kiếm</span>
                </div>
              </div>

              <div className="space-y-2">
                {!isAuthenticated ? (
                  <div className="p-3 text-center text-xs text-ink-400">
                    Bạn đang ở chế độ khách. Đăng nhập để xem lịch sử lộ trình cá nhân.
                  </div>
                ) : user?.history && user.history.length > 0 ? (
                  user.history.map((hist) => (
                    <div
                      key={hist.id}
                      className="p-3 rounded-2xl bg-white/70 border border-slate-200/70 shadow-glass-sm flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-ink-950 flex items-center gap-1.5">
                          <span>{hist.originName}</span>
                          <ArrowRight className="w-3 h-3 text-ink-400" />
                          <span>{hist.destName}</span>
                        </div>
                        <div className="text-[10px] text-ink-400 font-mono">
                          {hist.distanceKm.toFixed(1)} km · {Math.round(hist.durationMins)} phút ·{" "}
                          {new Date(hist.timestamp).toLocaleDateString("vi-VN")}
                        </div>
                      </div>

                      <Link
                        href="/"
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition"
                      >
                        Đi lại
                      </Link>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-center text-xs text-ink-400">
                    Chưa có lịch sử chuyến đi nào được ghi nhận.
                  </div>
                )}
              </div>
            </GlassCard>
          </div>

          {/* Right Column: Community Incident Report */}
          <div className="space-y-6">
            <GlassCard variant="elevated" className="space-y-4">
              <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-ink-800 border-b border-slate-200/70 pb-3">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Báo cáo sự cố cộng đồng</span>
              </div>

              <p className="text-xs text-ink-600 leading-relaxed">
                Đóng góp tình hình ngập nước hoặc ùn tắc tại đoạn đường bạn đang đi để cảnh báo cho cộng đồng tài xế TP.HCM.
              </p>

              {reportSubmitted ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2 animate-fadeIn">
                  <CheckCircle className="w-6 h-6 text-emerald-600 mx-auto" />
                  <p className="text-xs font-bold text-emerald-900">
                    Cảm ơn bạn đã đóng góp!
                  </p>
                  <p className="text-[11px] text-emerald-700">
                    Thông tin đã được ghi nhận và gửi đến hệ thống kiểm định.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleReportSubmit} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-ink-700 uppercase mb-1">
                      Tên tuyến đường / Điểm ngập
                    </label>
                    <GlassInput
                      placeholder="Ví dụ: Đường Nguyễn Hữu Cảnh..."
                      value={reportRoad}
                      onChange={(e) => setReportRoad(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ink-700 uppercase mb-1">
                      Khu vực quận / huyện
                    </label>
                    <select
                      value={reportDistrict}
                      onChange={(e) => setReportDistrict(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-2xl bg-white/85 text-ink-800 text-xs font-semibold border border-white/90 shadow-glass-sm outline-none"
                    >
                      <option value="Quận 1">Quận 1</option>
                      <option value="Quận 3">Quận 3</option>
                      <option value="Quận 7">Quận 7</option>
                      <option value="Bình Thạnh">Bình Thạnh</option>
                      <option value="Thành phố Thủ Đức">Thành phố Thủ Đức</option>
                      <option value="Tân Bình">Tân Bình</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ink-700 uppercase mb-1">
                      Mức độ ảnh hưởng
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setReportLevel("MODERATE")}
                        className={`p-2.5 rounded-xl border text-center font-bold transition cursor-pointer ${
                          reportLevel === "MODERATE"
                            ? "bg-amber-50 text-amber-800 border-amber-300 ring-2 ring-amber-400/20"
                            : "bg-white/80 border-slate-200 text-ink-700"
                        }`}
                      >
                        Ngập nhẹ / Vừa
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportLevel("CRITICAL")}
                        className={`p-2.5 rounded-xl border text-center font-bold transition cursor-pointer ${
                          reportLevel === "CRITICAL"
                            ? "bg-rose-50 text-rose-800 border-rose-300 ring-2 ring-rose-400/20"
                            : "bg-white/80 border-slate-200 text-ink-700"
                        }`}
                      >
                        Ngập sâu / Chết máy
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ink-700 uppercase mb-1">
                      Mô tả chi tiết (Tùy chọn)
                    </label>
                    <textarea
                      rows={3}
                      value={reportDesc}
                      onChange={(e) => setReportDesc(e.target.value)}
                      placeholder="Nước ngập qua nửa bánh xe, xe máy nên đi làn bên phải..."
                      className="w-full p-3 rounded-2xl bg-white/85 text-ink-950 text-xs font-medium border border-white/90 shadow-glass-sm outline-none resize-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/15"
                    />
                  </div>

                  <GlassButton variant="primary" type="submit" className="w-full">
                    <Send className="w-4 h-4 mr-2" />
                    <span>Gửi báo cáo sự cố</span>
                  </GlassButton>
                </form>
              )}
            </GlassCard>
          </div>
        </div>
      </main>
    </div>
  );
}

