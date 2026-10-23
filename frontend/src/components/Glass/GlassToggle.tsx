"use client";

import React, { useState, useRef, useEffect } from "react";
import { Camera, ChevronDown, Check, Layers, Image as ImageIcon, Route as RouteIcon } from "lucide-react";

export type CameraFilterMode = "ALL" | "ON_ROUTE" | "HAS_IMAGE";

interface GlassToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  cameraCount?: { active: number; total: number };
  filter?: CameraFilterMode;
  onFilterChange?: (filter: CameraFilterMode) => void;
}

export default function GlassToggle({
  checked,
  onChange,
  label = "Hiển thị camera",
  disabled = false,
  cameraCount,
  filter = "ALL",
  onFilterChange,
}: GlassToggleProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-1.5 select-none">
      {/* Main Switch Button */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`glass-pill flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-all duration-200 cursor-pointer border ${
          checked
            ? "bg-white/95 text-indigo-700 border-indigo-200/90 shadow-glass ring-2 ring-indigo-400/25"
            : "bg-white/80 text-ink-600 border-white/90 hover:bg-white hover:text-ink-950 shadow-glass-sm"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        title={checked ? "Ẩn camera giao thông" : "Hiện camera giao thông"}
      >
        <div className={`p-1 rounded-full transition-colors ${checked ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-ink-500"}`}>
          <Camera className="w-3.5 h-3.5" />
        </div>
        <span className="hidden sm:inline font-medium">{label}</span>
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${
            checked ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-ink-500"
          }`}
        >
          {checked ? "Bật" : "Tắt"}
        </span>
      </button>

      {/* Popover Filter Trigger when checked and onFilterChange provided */}
      {checked && onFilterChange && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            aria-label="Lọc loại camera"
            className="glass-pill flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium bg-white/85 hover:bg-white border border-white/90 shadow-glass-sm text-ink-700 transition"
            title="Lọc camera"
          >
            {cameraCount && (
              <span className="text-[10px] font-mono font-bold text-indigo-600">
                {cameraCount.active}
              </span>
            )}
            <ChevronDown className="w-3 h-3 text-ink-500" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl glass-panel-elevated p-1.5 border border-white/95 shadow-glass-elevated z-30 animate-fadeIn text-xs">
              <div className="px-2.5 py-1 text-[10px] font-bold text-ink-400 uppercase tracking-wider">
                {cameraCount ? `Đang hiện ${cameraCount.active}/${cameraCount.total} camera` : "Bộ lọc camera"}
              </div>

              <button
                type="button"
                onClick={() => {
                  onFilterChange("ALL");
                  setDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left transition ${
                  filter === "ALL" ? "bg-indigo-50 text-indigo-700 font-bold" : "text-ink-700 hover:bg-white/80"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Tất cả camera</span>
                </div>
                {filter === "ALL" && <Check className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  onFilterChange("ON_ROUTE");
                  setDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left transition ${
                  filter === "ON_ROUTE" ? "bg-indigo-50 text-indigo-700 font-bold" : "text-ink-700 hover:bg-white/80"
                }`}
              >
                <div className="flex items-center gap-2">
                  <RouteIcon className="w-3.5 h-3.5 text-amber-500" />
                  <span>Trên lộ trình</span>
                </div>
                {filter === "ON_ROUTE" && <Check className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  onFilterChange("HAS_IMAGE");
                  setDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left transition ${
                  filter === "HAS_IMAGE" ? "bg-indigo-50 text-indigo-700 font-bold" : "text-ink-700 hover:bg-white/80"
                }`}
              >
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-3.5 h-3.5 text-cyan-500" />
                  <span>Có ảnh trực tiếp</span>
                </div>
                {filter === "HAS_IMAGE" && <Check className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
