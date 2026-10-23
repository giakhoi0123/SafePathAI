"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import {
  User,
  ArrowLeft,
  Bike,
  Car,
  Bell,
  ShieldCheck,
  CheckCircle,
  AlertCircle,
  Key,
  LogOut,
  LogIn,
} from "lucide-react";
import { GlassCard, GlassButton, GlassBadge } from "../../components/Glass";

export default function AccountPage() {
  const { user, isConfigured, loginWithGoogle, loginDemo, logout, updateVehicle } = useAuth();
  const [saveToast, setSaveToast] = useState(false);

  const handleVehicleChange = (v: "motorcycle" | "car") => {
    updateVehicle(v);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
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
                Phương tiện di chuyển, cảnh báo & Xác thực
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
            <span>Đã cập nhật cài đặt thành công!</span>
          </div>
        )}

        {/* Profile Card */}
        <GlassCard variant="elevated" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-indigo-200 shadow-glass">
                <img
                  src={
                    user?.avatar ||
                    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                  }
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h3 className="text-base font-black text-ink-950">
                  {user ? user.name : "Khách vãng lai"}
                </h3>
                <p className="text-xs text-ink-500">
                  {user ? user.email : "Chưa đăng nhập tài khoản"}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <GlassBadge variant={user ? "emerald" : "slate"} size="sm">
                    {user ? "Đã đăng nhập" : "Khách"}
                  </GlassBadge>
                </div>
              </div>
            </div>

            <div>
              {user ? (
                <GlassButton variant="danger" size="sm" onClick={logout}>
                  <LogOut className="w-3.5 h-3.5 mr-1.5" />
                  <span>Đăng xuất</span>
                </GlassButton>
              ) : (
                <GlassButton variant="primary" size="md" onClick={loginWithGoogle}>
                  <LogIn className="w-4 h-4 mr-1.5" />
                  <span>Đăng nhập với Google</span>
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
              Hệ thống SafePathAI điều chỉnh ngưỡng cảnh báo ngập nước dựa trên chiều cao gầm xe của bạn.
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
                ? "Khóa Google Client ID đã được nhận diện. Bạn có thể đăng nhập trực tiếp bằng tài khoản Google."
                : "Chưa cấu hình NEXT_PUBLIC_GOOGLE_CLIENT_ID trong môi trường triển khai. Hệ thống chuyển sang hồ sơ người dùng mẫu an toàn mà không làm gián đoạn trải nghiệm."}
            </p>
          </div>
        </GlassCard>
      </main>
    </div>
  );
}

