"use client";

import React, { useEffect, useState, useRef } from "react";
import { Volume2, VolumeX, Sparkles, RotateCcw } from "lucide-react";
import { RiskLevel } from "../types/contracts";

interface VoiceHUDProps {
  explanation: string;
  overallRisk: RiskLevel;
  latestAlert?: string | null;
}

export const VoiceHUD: React.FC<VoiceHUDProps> = ({
  explanation,
  overallRisk,
  latestAlert,
}) => {
  const [isVoiceEnabled, setIsVoiceEnabled] = useState<boolean>(true);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const previousExplanationRef = useRef<string>("");

  // Speech synthesis function
  const speakText = (text: string) => {
    if (!isVoiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    try {
      window.speechSynthesis.cancel(); // Cancel any ongoing speech
      const cleanText = text.replace(/\[.*?\]/g, "").trim();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "vi-VN";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select Vietnamese voice if available
      const voices = window.speechSynthesis.getVoices();
      const viVoice = voices.find((v) => v.lang === "vi-VN" || v.lang.startsWith("vi"));
      if (viVoice) {
        utterance.voice = viVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("SpeechSynthesis error:", err);
      setIsSpeaking(false);
    }
  };

  // Auto-speak strictly when verified risk exists (CRITICAL or MODERATE)
  // Does not auto-speak unverified or calm states to prevent audio spam
  useEffect(() => {
    if (explanation && explanation !== previousExplanationRef.current) {
      previousExplanationRef.current = explanation;
      if (isVoiceEnabled && (overallRisk === RiskLevel.CRITICAL || overallRisk === RiskLevel.MODERATE)) {
        const timer = setTimeout(() => speakText(explanation), 300);
        return () => clearTimeout(timer);
      }
    }
  }, [explanation, overallRisk, isVoiceEnabled]);

  // Auto-speak verified emergency alert
  useEffect(() => {
    if (latestAlert && isVoiceEnabled) {
      speakText(latestAlert);
    }
  }, [latestAlert, isVoiceEnabled]);

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-xl text-white space-y-3">
      {/* Top Banner: Explanation Title & Audio Controls */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-500/20 text-blue-400 rounded-lg">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400">
              Trợ lý Giọng nói An toàn (SafePath Voice HUD)
            </h4>
            <p className="text-[11px] text-slate-400">
              Chỉ đọc cảnh báo rủi ro khi có chứng cứ quan trắc xác thực
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Replay Button */}
          <button
            onClick={() => speakText(explanation)}
            disabled={!explanation}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-lg transition"
            title="Đọc lại bằng giọng nói"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Voice Mute / Unmute Toggle */}
          <button
            onClick={() => {
              if (isVoiceEnabled && isSpeaking) {
                window.speechSynthesis.cancel();
                setIsSpeaking(false);
              }
              setIsVoiceEnabled(!isVoiceEnabled);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              isVoiceEnabled
                ? "bg-blue-600/30 text-blue-300 border border-blue-500/40 hover:bg-blue-600/40"
                : "bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700"
            }`}
          >
            {isVoiceEnabled ? (
              <>
                <Volume2 className={`w-3.5 h-3.5 ${isSpeaking ? "animate-bounce text-blue-400" : ""}`} />
                <span>Giọng đọc: BẬT</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                <span>Giọng đọc: TẮT</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main AI Explanation Paragraph */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 text-xs leading-relaxed text-slate-200">
        {explanation ? (
          <p className="font-medium text-slate-100">{explanation}</p>
        ) : (
          <p className="text-slate-500 italic">
            Chưa có lộ trình được tính toán. Hãy chọn điểm đi và điểm đến trên bản đồ để bắt đầu.
          </p>
        )}
      </div>
    </div>
  );
};
