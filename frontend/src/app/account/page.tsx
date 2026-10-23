"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import {
  User,
  ArrowLeft,
  Bike,
  Car,
  CheckCircle,
  AlertCircle,
  Key,
  LogOut,
  LogIn,
  MapPin,
  Clock,
  Trash2,
  Plus,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { GlassCard, GlassButton, GlassBadge } from "../../components/Glass";

export default function AccountPage() {
  const {
    user,
    isAuthenticated,
    isConfigured,
    oauthStatus,
    loginWithGoogle,
    logout,
    updateVehicle,
    savePlace,
    removeSavedPlace,
  } = useAuth();

  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [showAddPlace, setShowAddPlace] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceAddress, setNewPlaceAddress] = useState("");
  const [newPlaceCategory, setNewPlaceCategory] = useState("favorite");

  const handleVehicleChange = async (v: "motorcycle" | "car") => {
    if (!isAuthenticated) {
      setSaveToast("Vui lòng đăng nhập để lưu phương tiện mặc định vào tài khoản.");
      setTimeout(() => setSaveToast(null), 3000);
      return;
    }
    await updateVehicle(v);
    setSaveToast("Đã cập nhật phương tiện di chuyển chính vào cơ sở dữ liệu!");
    setTimeout(() => setSaveToast(null), 3000);
  };

  const handleAddPlaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaceName.trim() || !newPlaceAddress.trim()) return;
    await savePlace({
      name: newPlaceName.trim(),
      address: newPlaceAddress.trim(),
      lat: 10.7769,
      lng: 106.7009,
      label: newPlaceCategory,
    });
    setNewPlaceName("");
    setNewPlaceAddress("");
    setShowAddPlace(false);
    setSaveToast("Đã lưu địa điểm mới thành công!");
    setTimeout(() => setSaveToast(null), 3000);
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
              <User className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-ink-950">
                Tài khoản & Cài đặt <span className="aurora-gradient-text">SafePathAI</span>
              </h1>
              <p className="text-[11px] text-ink-500 leading-none mt-0.5">
                Xác thực Google, phương tiện & địa điểm lưu trữ
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
            className="px-3 py-1.5 rounded-full text-xs font-semibold text-ink-700 hover:text-ink-950 hover:bg-white/70 transition"
          >
            Bảng tin
          </Link>
          <Link
            href="/account"
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-white/90 text-indigo-700 shadow-glass-sm border border-indigo-200/80"
          >
            Tài khoản
          </Link>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 p-5 max-w-4xl mx-auto w-full space-y-6">
        {saveToast && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-800 text-xs font-bold flex items-center gap-2 shadow-sm animate-fadeIn">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span>{saveToast}</span>
          </div>
        )}

        {/* Configuration Warning Banner if OAuth credentials are not provided */}
        {oauthStatus === "BLOCKED_CONFIGURATION" && (
          <div className="p-4 bg-amber-50/90 border border-amber-300 rounded-3xl shadow-glass flex items-start gap-3 text-xs text-amber-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-amber-950 flex items-center gap-2">
                <span>Google OAuth: Trạng thái BLOCKED_CONFIGURATION</span>
                <GlassBadge variant="amber" size="sm">Thiếu biến môi trường</GlassBadge>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Máy chủ chưa thiết lập biến môi trường <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">AUTH_GOOGLE_ID</code> và <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold">AUTH_GOOGLE_SECRET</code>. Theo nguyên tắc Zero-Mock, hệ thống giữ nguyên trạng thái khách (Guest) và không giả lập phiên đăng nhập giả.
              </p>
            </div>
          </div>
        )}

        {/* Profile Card */}
        <GlassCard variant="elevated" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-indigo-200 shadow-glass bg-indigo-50 flex items-center justify-center shrink-0">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-8 h-8 text-indigo-400" />
                )}
              </div>
              <div>
                <h3 className="text-base font-black text-ink-950">
                  {isAuthenticated && user ? user.name : "Bạn chưa đăng nhập"}
                </h3>
                <p className="text-xs text-ink-500">
                  {isAuthenticated && user ? user.email : "Đăng nhập Google để lưu địa điểm và lịch sử tuyến đường"}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <GlassBadge variant={isAuthenticated ? "emerald" : "slate"} size="sm">
                    {isAuthenticated ? "Đã xác thực Google" : "Khách (Chưa đăng nhập)"}
                  </GlassBadge>
                </div>
              </div>
            </div>

            <div>
              {isAuthenticated ? (
                <GlassButton variant="danger" size="sm" onClick={logout}>
                  <LogOut className="w-3.5 h-3.5 mr-1.5" />
                  <span>Đăng xuất</span>
                </GlassButton>
              ) : (
                <GlassButton
                  variant="primary"
                  size="md"
                  onClick={loginWithGoogle}
                  disabled={!isConfigured}
                  title={!isConfigured ? "Cần cấu hình AUTH_GOOGLE_ID và AUTH_GOOGLE_SECRET" : "Đăng nhập bằng tài khoản Google"}
                >
                  <LogIn className="w-4 h-4 mr-1.5" />
                  <span>Tiếp tục với Google</span>
                </GlassButton>
              )}
            </div>
          </div>
        </GlassCard>

        {/* Vehicle Selection Card */}
        <GlassCard variant="elevated" className="space-y-4">
          <div className="border-b border-slate-200/70 pb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-800 flex items-center gap-2">
              <Car className="w-4 h-4 text-indigo-600" />
              <span>Phương tiện di chuyển chính</span>
            </h4>
            <p className="text-xs text-ink-500 mt-1">
              Hệ thống SafePathAI điều chỉnh ngưỡng cảnh báo ngập nước dựa trên độ cao gầm xe của bạn.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Motorcycle option */}
            <div
              onClick={() => handleVehicleChange("motorcycle")}
              className={`p-4 rounded-3xl border transition cursor-pointer flex items-center gap-4 ${
                (user?.vehicle || "motorcycle") === "motorcycle"
                  ? "bg-white border-indigo-300 shadow-glass-elevated ring-2 ring-indigo-400/25"
                  : "bg-white/70 border-slate-200/80 hover:bg-white"
              }`}
            >
              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-600">
                <Bike className="w-6 h-6" />
              </div>
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-ink-950 flex items-center gap-1.5">
                  <span>Xe máy (2 bánh)</span>
                  {(user?.vehicle || "motorcycle") === "motorcycle" && (
                    <CheckCircle className="w-4 h-4 text-indigo-600" />
                  )}
                </div>
                <p className="text-[11px] text-ink-500 leading-snug">
                  Cảnh báo rủi ro khi mực nước vượt quá 15 - 20cm (tránh ngập ống xả & lọc gió).
                </p>
              </div>
            </div>

            {/* Car option */}
            <div
              onClick={() => handleVehicleChange("car")}
              className={`p-4 rounded-3xl border transition cursor-pointer flex items-center gap-4 ${
                user?.vehicle === "car"
                  ? "bg-white border-indigo-300 shadow-glass-elevated ring-2 ring-indigo-400/25"
                  : "bg-white/70 border-slate-200/80 hover:bg-white"
              }`}
            >
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-2xl text-blue-600">
                <Car className="w-6 h-6" />
              </div>
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-ink-950 flex items-center gap-1.5">
                  <span>Ô tô (4 bánh)</span>
                  {user?.vehicle === "car" && (
                    <CheckCircle className="w-4 h-4 text-indigo-600" />
                  )}
                </div>
                <p className="text-[11px] text-ink-500 leading-snug">
                  Cảnh báo rủi ro khi mực nước vượt quá 25 - 30cm (tránh thủy kích & trôi xe).
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Saved Places Card */}
        <GlassCard variant="elevated" className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200/70 pb-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-800 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span>Địa điểm đã lưu ({user?.savedPlaces?.length || 0})</span>
              </h4>
              <p className="text-xs text-ink-500 mt-1">
                Lưu nhanh các vị trí thường đi để chọn tuyến chỉ với 1 chạm.
              </p>
            </div>
            {isAuthenticated && (
              <GlassButton
                variant="secondary"
                size="sm"
                onClick={() => setShowAddPlace(!showAddPlace)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                <span>{showAddPlace ? "Đóng" : "Thêm mới"}</span>
              </GlassButton>
            )}
          </div>

          {!isAuthenticated ? (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-ink-500">
              Bạn đang ở chế độ khách. Hãy đăng nhập tài khoản để lưu các địa điểm yêu thích.
            </div>
          ) : (
            <div className="space-y-3">
              {showAddPlace && (
                <form onSubmit={handleAddPlaceSubmit} className="p-3.5 bg-indigo-50/60 rounded-2xl border border-indigo-200/80 space-y-3">
                  <div className="font-bold text-xs text-indigo-950">Thêm địa điểm yêu thích mới</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Tên gợi nhớ (e.g. Nhà riêng, Cơ quan)"
                      value={newPlaceName}
                      onChange={(e) => setNewPlaceName(e.target.value)}
                      className="px-3 py-1.5 rounded-xl border border-indigo-200 bg-white text-xs text-ink-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                    <input
                      type="text"
                      placeholder="Địa chỉ cụ thể tại TP.HCM"
                      value={newPlaceAddress}
                      onChange={(e) => setNewPlaceAddress(e.target.value)}
                      className="px-3 py-1.5 rounded-xl border border-indigo-200 bg-white text-xs text-ink-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <GlassButton type="button" variant="ghost" size="sm" onClick={() => setShowAddPlace(false)}>Hủy</GlassButton>
                    <GlassButton type="submit" variant="primary" size="sm">Lưu địa điểm</GlassButton>
                  </div>
                </form>
              )}

              {user?.savedPlaces && user.savedPlaces.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {user.savedPlaces.map((sp) => (
                    <div key={sp.id} className="py-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                          <MapPin className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-ink-950">{sp.name}</div>
                          <div className="text-[11px] text-ink-500">{sp.address || sp.name}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeSavedPlace(sp.id)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition"
                        title="Xóa địa điểm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-center text-xs text-ink-400">
                  Chưa có địa điểm nào được lưu trong cơ sở dữ liệu.
                </div>
              )}
            </div>
          )}
        </GlassCard>

        {/* Route History Card */}
        <GlassCard variant="elevated" className="space-y-4">
          <div className="border-b border-slate-200/70 pb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Lịch sử các tuyến đường đã tìm ({user?.history?.length || 0})</span>
            </h4>
            <p className="text-xs text-ink-500 mt-1">
              Lưu trữ an toàn trên cơ sở dữ liệu PostgreSQL cho tài khoản đã xác thực.
            </p>
          </div>

          {!isAuthenticated ? (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-ink-500">
              Bạn đang ở chế độ khách. Các tuyến đường tìm kiếm sẽ không được lưu vào tài khoản.
            </div>
          ) : user?.history && user.history.length > 0 ? (
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {user.history.map((h) => (
                <div key={h.id} className="py-2.5 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-ink-950 flex items-center gap-1.5">
                      <span>{h.originName}</span>
                      <span className="text-slate-400">→</span>
                      <span>{h.destName}</span>
                    </div>
                    <div className="text-[10px] text-ink-400 font-mono">
                      {h.distanceKm.toFixed(1)} km • ~{Math.round(h.durationMins)} phút • {new Date(h.timestamp).toLocaleDateString("vi-VN")}
                    </div>
                  </div>
                  <GlassBadge variant="indigo" size="sm">
                    {Math.round(h.durationMins)}p
                  </GlassBadge>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 text-center text-xs text-ink-400">
              Chưa có lịch sử lộ trình nào.
            </div>
          )}
        </GlassCard>

        {/* OAuth 2.0 Security & Integration Info */}
        <GlassCard variant="elevated" className="space-y-3">
          <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-ink-800 border-b border-slate-200/70 pb-3">
            <Key className="w-4 h-4 text-indigo-600" />
            <span>Trạng thái Xác thực Google OAuth 2.0</span>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/70 border border-slate-200/80 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink-700">Tích hợp Google OAuth:</span>
              <GlassBadge variant={isConfigured ? "emerald" : "amber"} size="sm">
                {isConfigured ? "ĐÃ CẤU HÌNH (LIVE)" : "BLOCKED_CONFIGURATION"}
              </GlassBadge>
            </div>
            <p className="text-[11px] text-ink-500 leading-relaxed">
              {isConfigured
                ? "Khóa Google Client ID & Secret đã được nhận diện. Bạn có thể đăng nhập trực tiếp bằng tài khoản Google."
                : "Chưa cấu hình AUTH_GOOGLE_ID và AUTH_GOOGLE_SECRET trong file môi trường (.env / .env.local). Hệ thống giữ trạng thái khách, không dùng tài khoản giả lập."}
            </p>
          </div>
        </GlassCard>
      </main>
    </div>
  );
}
