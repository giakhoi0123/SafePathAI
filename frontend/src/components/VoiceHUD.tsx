"use client";
import { useEffect, useState } from "react";
import { AudioLines, Camera, ChevronDown, CloudRain, Sun, Volume2, Waves, AlertTriangle } from "lucide-react";
import type { WeatherTideSignal } from "../types/contracts";
import { currentRain, currentTide, observationTime } from "../lib/observations";

export function VoiceHUD({ weather, cameraCount, explanation, alert, now }: {
  weather: WeatherTideSignal | null;
  cameraCount: number | null;
  explanation: string;
  alert?: string;
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const rain = currentRain(weather, now), tide = currentTide(weather, now);
  const message = alert || explanation || "Chọn điểm đi và điểm đến để nhận lộ trình tối ưu và thông tin cảnh báo ngập nước thực tế.";
  useEffect(() => {
    setSupported("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, []);
  useEffect(() => { if (alert) setExpanded(true); }, [alert]);
  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [message]);
  function speak() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    if (speaking) { setSpeaking(false); return; }
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "vi-VN";
    const voice = window.speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith("vi"));
    if (voice) utterance.voice = voice;
    utterance.onend = utterance.onerror = () => setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.speak(utterance);
  }
  return (
    <div className={`voice-hud ${expanded ? "expanded rounded-3xl" : "rounded-full"} border border-white/95 backdrop-blur-2xl transition-all duration-300`}>
      <button
        className="hud-summary select-none"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="hud-detail"
        aria-label="Thông tin quan trắc và giải thích tuyến"
      >
        <div className="p-1 rounded-full bg-indigo-50 border border-indigo-100/80 text-indigo-600 shrink-0">
          <AudioLines size={16} />
        </div>
        <span className="flex items-center gap-1 font-semibold text-xs text-ink-900">
          {rain !== null && rain > 0 ? (
            <CloudRain size={14} className="text-blue-500 animate-pulse" />
          ) : (
            <Sun size={14} className="text-amber-500" />
          )}
          {rain?.toFixed(1) ?? "—"} <small className="text-ink-500 font-bold">mm/h</small>
        </span>
        <span className="flex items-center gap-1 font-semibold text-xs text-ink-900">
          <Waves size={14} className="text-cyan-600" />
          {tide?.toFixed(2) ?? "—"} <small className="text-ink-500 font-bold">m</small>
        </span>
        <span className="flex items-center gap-1 font-semibold text-xs text-ink-900">
          <Camera size={14} className="text-indigo-600" />
          {cameraCount ?? "—"} <small className="text-emerald-700 font-bold">LIVE</small>
        </span>
        {alert && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-rose-700 font-bold text-[10px]">
            <AlertTriangle size={11} /> Cảnh báo
          </span>
        )}
        <ChevronDown size={14} className={`text-ink-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div id="hud-detail" className="hud-detail animate-fadeIn">
          <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block mb-1">
            Thông tin theo bằng chứng thực địa
          </span>
          <p aria-live="polite" className="text-xs font-semibold text-ink-900 leading-relaxed my-2">
            {message}
          </p>
          <dl className="hud-provenance text-[11px] border-t border-slate-200/80 pt-2 my-2">
            <dt className="font-bold text-ink-800">Lượng mưa:</dt>
            <dd className="text-ink-600">{rain === null ? "Chưa có quan trắc đủ mới" : `${rain.toFixed(1)} mm/h (${observationTime(weather?.rain_observed_at)})`}</dd>
            <dt className="font-bold text-ink-800">Thủy triều:</dt>
            <dd className="text-ink-600">{tide === null ? "Chờ bản tin tiếp theo" : `${tide.toFixed(2)}m trạm ${weather?.tide_station || "Hòn Dấu"} (${observationTime(weather?.tide_observed_at)})`}</dd>
            <dt className="font-bold text-ink-800">Camera LIVE:</dt>
            <dd className="text-ink-600">Mạng lưới 796 camera giao thông TP.HCM, cập nhật snapshot thực tế.</dd>
          </dl>
          <button
            onClick={speak}
            disabled={!supported}
            className="hud-speak"
          >
            <Volume2 size={14} />
            <span>{!supported ? "Thiết bị không hỗ trợ giọng nói" : speaking ? "Dừng đọc" : "Đọc thông tin tuyến"}</span>
            {speaking && <span className="voice-bars"><i /><i /><i /><i /></span>}
          </button>
        </div>
      )}
    </div>
  );
}
