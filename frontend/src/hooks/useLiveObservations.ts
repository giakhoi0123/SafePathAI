"use client";
import { useEffect, useState } from "react";
import { fetchCameras, fetchCameraSummary, fetchHealth, fetchModelStatus, fetchWeatherTide } from "../services/api";
import type { CameraEvidence, CameraSummary, ModelStatusResponse, WeatherTideSignal } from "../types/contracts";

export function useLiveObservations() {
  const [cameras, setCameras] = useState<CameraEvidence[]>([]);
  const [summary, setSummary] = useState<CameraSummary | null>(null);
  const [weather, setWeather] = useState<WeatherTideSignal | null>(null);
  const [models, setModels] = useState<ModelStatusResponse | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const results = await Promise.allSettled([fetchCameras(), fetchCameraSummary(), fetchWeatherTide(), fetchModelStatus(), fetchHealth()] as const);
      if (!active) return;
      const [c, s, w, m, h] = results;
      setCameras(c.status === "fulfilled" ? c.value.filter(item => ["LIVE", "STALE"].includes(item.source_status)) : []);
      setSummary(s.status === "fulfilled" ? s.value : null);
      setWeather(w.status === "fulfilled" ? w.value : null);
      setModels(m.status === "fulfilled" ? m.value : null);
      setHealth(h.status === "fulfilled" ? h.value : null);
      const names = ["camera", "thống kê mạng lưới", "thời tiết / triều", "trạng thái mô hình", "hạ tầng"];
      setErrors(results.flatMap((r, i) => r.status === "rejected" ? [names[i]] : []));
      setNow(Date.now()); setLoading(false);
      timer = setTimeout(refresh, 30000);
    }
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 10000);
    return () => { active = false; clearTimeout(timer); clearInterval(clock); };
  }, [revision]);
  return { cameras, summary, weather, models, health, errors, loading, now, refresh: () => setRevision(value => value + 1) };
}
