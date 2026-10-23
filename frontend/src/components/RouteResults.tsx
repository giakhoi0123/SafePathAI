"use client";

import React, { useState } from "react";
import { CameraEvidence, RiskLevel, SafeRouteResponse } from "../types/contracts";
import { Clock, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

interface Props {
  selected: SafeRouteResponse;
  alternatives: SafeRouteResponse[];
  selectedStepIndex: number | null;
  onSelect: (route: SafeRouteResponse) => void;
  onSelectStep: (index: number | null) => void;
  onSelectCamera: (camera: CameraEvidence) => void;
}

const hasRiskEvidence = (route: SafeRouteResponse) => route.segments.some((s) =>
  s.risk_level !== RiskLevel.UNKNOWN && s.risk_level !== RiskLevel.INSUFFICIENT_EVIDENCE &&
  (s.historical_flood_prone === true || s.evidence_cameras.length > 0)
);
const riskCost = (route: SafeRouteResponse) =>
  (route.critical_segments_count || 0) * 10000 + (route.moderate_segments_count || 0) * 1000 + (route.unknown_segments_count || 0);
const allUnknown = (route: SafeRouteResponse) => !route.segments.length || route.segments.every((s) =>
  s.risk_level === RiskLevel.UNKNOWN || s.risk_level === RiskLevel.INSUFFICIENT_EVIDENCE
);

export const RouteResults: React.FC<Props> = ({ selected, alternatives, selectedStepIndex, onSelect, onSelectStep, onSelectCamera }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const routes = [selected, ...alternatives];
  const fastest = routes.reduce((best, route) => route.estimated_time_mins < best.estimated_time_mins ? route : best);
  const evidenced = routes.filter(hasRiskEvidence);
  const leastRisk = evidenced.length ? evidenced.reduce((best, route) => riskCost(route) < riskCost(best) ? route : best) : null;
  const other = routes.filter((r) => r.route_id !== fastest.route_id && r.route_id !== leastRisk?.route_id);
  const label = (route: SafeRouteResponse) => route.route_id === fastest.route_id
    ? (allUnknown(route) ? "Đường đề xuất theo thời gian" : "Nhanh nhất")
    : route.route_id === leastRisk?.route_id ? "Ít rủi ro đã ghi nhận" : "Đường khác";
  const coverage = allUnknown(selected)
    ? "Chưa đủ dữ liệu để xác nhận mức rủi ro của toàn tuyến."
    : selected.unknown_segments_count ? `${selected.unknown_segments_count} đoạn chưa có đủ dữ liệu rủi ro.` : "Có dữ liệu rủi ro cho các đoạn trên tuyến.";

  return <section className="space-y-3" aria-label="Tuyến đường">
    <h2 className="text-sm font-bold text-white">Tuyến đường</h2>
    <div role="tablist" aria-label="Chọn tuyến đường" className="flex gap-2 overflow-x-auto pb-1">
      <button role="tab" aria-selected={selected.route_id === fastest.route_id} onClick={() => { onSelect(fastest); setDetailsOpen(false); }} className="min-h-11 shrink-0 rounded-full border border-slate-600 px-3 py-2 text-xs aria-selected:bg-blue-600 aria-selected:border-blue-500">Nhanh nhất</button>
      {leastRisk && leastRisk.route_id !== fastest.route_id && <button role="tab" aria-selected={selected.route_id === leastRisk.route_id} onClick={() => { onSelect(leastRisk); setDetailsOpen(false); }} className="min-h-11 shrink-0 rounded-full border border-slate-600 px-3 py-2 text-xs aria-selected:bg-blue-600 aria-selected:border-blue-500">Ít rủi ro đã ghi nhận</button>}
      {other.length > 0 && <button role="tab" aria-selected={other.some((r) => r.route_id === selected.route_id)} onClick={() => { onSelect(other[0]); setDetailsOpen(false); }} className="min-h-11 shrink-0 rounded-full border border-slate-600 px-3 py-2 text-xs aria-selected:bg-blue-600 aria-selected:border-blue-500">Đường khác</button>}
    </div>
    <div className="space-y-2">
      {routes.map((route) => <button key={route.route_id} type="button" aria-pressed={route.route_id === selected.route_id} aria-label={`Chọn ${label(route)}, ${route.estimated_time_mins.toFixed(1)} phút, ${route.total_distance_km.toFixed(1)} km`} onClick={() => { onSelect(route); setDetailsOpen(false); }} className="block w-full min-h-20 rounded-xl border-2 p-3 text-left transition-colors aria-pressed:border-sky-400 aria-pressed:bg-slate-800 border-slate-700 bg-slate-950 hover:border-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
        <div className="flex items-center justify-between gap-2"><span className="font-semibold text-white">{label(route)}</span>{route.route_id === selected.route_id && <span className="rounded bg-sky-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">Tuyến đang chọn</span>}</div>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-200"><Clock className="h-4 w-4 text-sky-400" /><strong>{route.estimated_time_mins.toFixed(1)} phút</strong><span>· {route.total_distance_km.toFixed(1)} km</span></div>
        <p className="mt-1 text-xs text-slate-400">{allUnknown(route) ? "Rủi ro chưa xác minh" : route.unknown_segments_count ? "Một phần tuyến chưa có dữ liệu rủi ro" : "Có dữ liệu rủi ro"}</p>
      </button>)}
    </div>
    {routes.length === 1 && <p className="text-xs text-slate-400">Chỉ tìm được một tuyến hợp lệ.</p>}
    <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200">
      <h3 className="font-semibold text-white">Đoạn cần lưu ý</h3>
      <p className="mt-1 text-xs leading-relaxed">{coverage}</p>
      {selected.segments.filter((s) => s.risk_level === RiskLevel.CRITICAL || s.risk_level === RiskLevel.MODERATE).map((s, i) => <p key={i} className="mt-2 flex items-start gap-2 text-xs text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />{s.street_name || "Đoạn đường chưa đặt tên"}: {s.risk_level === RiskLevel.CRITICAL ? "cần đặc biệt thận trọng" : "cần lưu ý"}</p>)}
    </div>
    <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
      <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between rounded py-1 text-left text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"><span>Chỉ đường</span>{detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
      {detailsOpen && <ol className="mt-2 max-h-64 space-y-1 overflow-y-auto border-t border-slate-800 pt-2">
        {selected.segments.map((segment, index) => <li key={index}><button type="button" aria-pressed={selectedStepIndex === index} onClick={() => onSelectStep(selectedStepIndex === index ? null : index)} className="w-full rounded-lg p-2 text-left text-xs text-slate-200 hover:bg-slate-800 aria-pressed:bg-amber-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"><span className="font-semibold">{index + 1}. {segment.street_name || "Tiếp tục theo đường"}</span><span className="ml-2 text-slate-400">{Math.round(segment.length_meters)} m</span></button>{segment.evidence_cameras.map((camera) => <button key={camera.cam_id} onClick={() => onSelectCamera(camera)} className="ml-2 rounded px-2 py-1 text-xs text-sky-300 underline">Xem camera {camera.code || camera.name}</button>)}</li>)}
      </ol>}
    </div>
  </section>;
};
