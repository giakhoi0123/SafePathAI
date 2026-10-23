"use client";

import React, { useState } from "react";
import { CameraEvidence, RiskLevel, SafeRouteResponse } from "../types/contracts";
import { Clock, ChevronDown, ChevronUp, AlertTriangle, Navigation2, Camera } from "lucide-react";

interface Props {
  selected: SafeRouteResponse;
  alternatives: SafeRouteResponse[];
  selectedStepIndex: number | null;
  onSelect: (route: SafeRouteResponse) => void;
  onSelectStep: (index: number | null) => void;
  onSelectCamera: (camera: CameraEvidence) => void;
}

const hasRiskEvidence = (route: SafeRouteResponse) =>
  route.segments.some(
    (s) =>
      s.risk_level !== RiskLevel.UNKNOWN &&
      s.risk_level !== RiskLevel.INSUFFICIENT_EVIDENCE &&
      (s.historical_flood_prone === true || s.evidence_cameras.length > 0)
  );

const riskCost = (route: SafeRouteResponse) =>
  (route.critical_segments_count || 0) * 10000 +
  (route.moderate_segments_count || 0) * 1000 +
  (route.unknown_segments_count || 0);

const allUnknown = (route: SafeRouteResponse) =>
  !route.segments.length ||
  route.segments.every(
    (s) => s.risk_level === RiskLevel.UNKNOWN || s.risk_level === RiskLevel.INSUFFICIENT_EVIDENCE
  );

export const RouteResults: React.FC<Props> = ({
  selected,
  alternatives,
  selectedStepIndex,
  onSelect,
  onSelectStep,
  onSelectCamera,
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const routes = [selected, ...alternatives];
  const fastest = routes.reduce((best, route) =>
    route.estimated_time_mins < best.estimated_time_mins ? route : best
  );
  const evidenced = routes.filter(hasRiskEvidence);
  const leastRisk = evidenced.length
    ? evidenced.reduce((best, route) => (riskCost(route) < riskCost(best) ? route : best))
    : null;
  const other = routes.filter((r) => r.route_id !== fastest.route_id && r.route_id !== leastRisk?.route_id);

  const label = (route: SafeRouteResponse) =>
    route.route_id === fastest.route_id
      ? allUnknown(route)
        ? "Đường đề xuất theo thời gian"
        : "Nhanh nhất"
      : route.route_id === leastRisk?.route_id
      ? "Ít rủi ro đã ghi nhận"
      : "Đường khác";

  const coverage = allUnknown(selected)
    ? "Chưa đủ dữ liệu để xác nhận mức rủi ro của toàn tuyến."
    : selected.unknown_segments_count
    ? `${selected.unknown_segments_count} đoạn chưa có đủ dữ liệu rủi ro.`
    : "Có dữ liệu rủi ro cho các đoạn trên tuyến.";

  return (
    <section className="space-y-3" aria-label="Tuyến đường">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink-900 flex items-center gap-2">
          <Navigation2 className="w-4 h-4 text-indigo-600" />
          <span>Tuyến đường khả dụng</span>
        </h2>
        <span className="text-[11px] font-medium text-ink-500">
          {routes.length} phương án
        </span>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Chọn tuyến đường" className="flex gap-2 overflow-x-auto pb-1">
        <button
          role="tab"
          aria-selected={selected.route_id === fastest.route_id}
          onClick={() => {
            onSelect(fastest);
            setDetailsOpen(false);
          }}
          className="min-h-10 shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 border border-slate-200/80 bg-white/70 text-ink-700 hover:bg-white aria-selected:bg-gradient-to-r aria-selected:from-indigo-600 aria-selected:to-blue-600 aria-selected:border-transparent aria-selected:text-white aria-selected:shadow-md"
        >
          Nhanh nhất
        </button>
        {leastRisk && leastRisk.route_id !== fastest.route_id && (
          <button
            role="tab"
            aria-selected={selected.route_id === leastRisk.route_id}
            onClick={() => {
              onSelect(leastRisk);
              setDetailsOpen(false);
            }}
            className="min-h-10 shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 border border-slate-200/80 bg-white/70 text-ink-700 hover:bg-white aria-selected:bg-gradient-to-r aria-selected:from-indigo-600 aria-selected:to-blue-600 aria-selected:border-transparent aria-selected:text-white aria-selected:shadow-md"
          >
            Ít rủi ro đã ghi nhận
          </button>
        )}
        {other.length > 0 && (
          <button
            role="tab"
            aria-selected={other.some((r) => r.route_id === selected.route_id)}
            onClick={() => {
              onSelect(other[0]);
              setDetailsOpen(false);
            }}
            className="min-h-10 shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 border border-slate-200/80 bg-white/70 text-ink-700 hover:bg-white aria-selected:bg-gradient-to-r aria-selected:from-indigo-600 aria-selected:to-blue-600 aria-selected:border-transparent aria-selected:text-white aria-selected:shadow-md"
          >
            Đường khác
          </button>
        )}
      </div>

      {/* Route Cards */}
      <div className="space-y-2">
        {routes.map((route) => (
          <button
            key={route.route_id}
            type="button"
            aria-pressed={route.route_id === selected.route_id}
            aria-label={`Chọn ${label(route)}, ${route.estimated_time_mins.toFixed(1)} phút, ${route.total_distance_km.toFixed(1)} km`}
            onClick={() => {
              onSelect(route);
              setDetailsOpen(false);
            }}
            className="block w-full min-h-20 rounded-2xl border p-3.5 text-left transition-all duration-200 cursor-pointer bg-white/80 border-slate-200/80 shadow-glass-sm hover:border-indigo-300 hover:bg-white aria-pressed:border-indigo-400 aria-pressed:bg-gradient-to-br aria-pressed:from-indigo-50/70 aria-pressed:to-ice-100/60 aria-pressed:shadow-glass focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink-900 text-xs sm:text-sm">{label(route)}</span>
              {route.route_id === selected.route_id && (
                <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                  Tuyến đang chọn
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-sm text-ink-800">
              <Clock className="h-4 w-4 text-indigo-600" />
              <strong className="text-ink-950 font-bold">{route.estimated_time_mins.toFixed(1)} phút</strong>
              <span className="text-ink-500 font-medium">· {route.total_distance_km.toFixed(1)} km</span>
            </div>
            <p className="mt-1 text-xs text-ink-600">
              {allUnknown(route)
                ? "Chưa đủ dữ liệu xác minh rủi ro"
                : route.unknown_segments_count
                ? "Một phần tuyến chưa có dữ liệu rủi ro"
                : "Có dữ liệu rủi ro đầy đủ"}
            </p>
          </button>
        ))}
      </div>

      {routes.length === 1 && (
        <p className="text-xs text-ink-500 italic">Chỉ tìm được một tuyến hợp lệ.</p>
      )}

      {/* Caution & Notice Card */}
      <div className="rounded-2xl glass-panel p-3.5 text-xs text-ink-800 border border-slate-200/80">
        <h3 className="font-bold text-ink-900 flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span>Đoạn cần lưu ý</span>
        </h3>
        <p className="mt-1 text-ink-600 leading-relaxed">{coverage}</p>
        {selected.segments
          .filter((s) => s.risk_level === RiskLevel.CRITICAL || s.risk_level === RiskLevel.MODERATE)
          .map((s, i) => (
            <p key={i} className="mt-2 flex items-start gap-1.5 text-amber-800 font-medium">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
              <span>
                {s.street_name || "Đoạn đường chưa đặt tên"}:{" "}
                <strong>{s.risk_level === RiskLevel.CRITICAL ? "cần đặc biệt thận trọng" : "cần lưu ý"}</strong>
              </span>
            </p>
          ))}
      </div>

      {/* Step by Step Details */}
      <div className="rounded-2xl glass-panel p-3 border border-slate-200/80">
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex min-h-10 w-full items-center justify-between rounded-xl px-1 py-1 text-left text-xs font-bold text-ink-900 hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 transition"
        >
          <span>Chỉ đường</span>
          {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {detailsOpen && (
          <ol className="mt-2.5 max-h-64 space-y-1.5 overflow-y-auto border-t border-slate-100 pt-2.5">
            {selected.segments.map((segment, index) => (
              <li key={index} className="space-y-1">
                <button
                  type="button"
                  aria-pressed={selectedStepIndex === index}
                  onClick={() => onSelectStep(selectedStepIndex === index ? null : index)}
                  className="w-full rounded-xl p-2 text-left text-xs font-medium text-ink-800 hover:bg-slate-100/80 aria-pressed:bg-indigo-100/80 aria-pressed:text-indigo-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 transition flex items-center justify-between"
                >
                  <span className="font-semibold truncate">
                    {index + 1}. {segment.street_name || "Tiếp tục theo đường"}
                  </span>
                  <span className="ml-2 text-ink-500 font-mono shrink-0">
                    {Math.round(segment.length_meters)} m
                  </span>
                </button>
                {segment.evidence_cameras.map((camera) => (
                  <button
                    key={camera.cam_id}
                    onClick={() => onSelectCamera(camera)}
                    className="ml-3 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition"
                  >
                    <Camera className="w-3 h-3 text-indigo-600" />
                    <span>Xem camera {camera.code || camera.name}</span>
                  </button>
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};
