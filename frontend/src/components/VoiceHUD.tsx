"use client";
import { useEffect, useState } from "react";
import { AudioLines, Camera, ChevronDown, CloudRain, Volume2, Waves } from "lucide-react";
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
  const message = alert || explanation || "Chọn điểm đi và điểm đến để nhận thông tin tuyến từ OSRM. Chưa có đủ bằng chứng thì rủi ro được đánh dấu chưa xác minh.";
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
  return <div className={`voice-hud liquid-island ${expanded ? "expanded" : ""}`}>
    <button className="hud-summary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="hud-detail" aria-label="Thông tin quan trắc và giải thích tuyến">
      <AudioLines size={18} className="mint"/>
      <span><CloudRain size={14}/>{rain?.toFixed(1) ?? "—"} <small>mm/h</small></span>
      <span><Waves size={14}/>{tide?.toFixed(2) ?? "—"} <small>m</small></span>
      <span><Camera size={14}/>{cameraCount ?? "—"} <small>LIVE</small></span><ChevronDown size={14}/>
    </button>
    {expanded && <div id="hud-detail" className="hud-detail">
      <span className="eyebrow">THÔNG TIN THEO BẰNG CHỨNG</span><p aria-live="polite">{message}</p>
      <dl className="hud-provenance"><dt>Mưa</dt><dd>{rain === null ? "Chưa có quan trắc đủ mới" : observationTime(weather?.rain_observed_at)}</dd><dt>Triều</dt><dd>{tide === null ? "Chưa có bản tin đủ mới / đủ nguồn" : observationTime(weather?.tide_observed_at)}</dd><dt>Camera LIVE</dt><dd>Chỉ đếm ảnh có giờ chụp được xác minh và còn mới.</dd></dl>
      <button onClick={speak} disabled={!supported} className="hud-speak"><Volume2 size={14}/>{!supported ? "Thiết bị không hỗ trợ giọng nói" : speaking ? "Dừng đọc" : "Đọc thông tin tuyến"}{speaking && <span className="voice-bars"><i/><i/><i/><i/></span>}</button>
    </div>}
  </div>;
}
