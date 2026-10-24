"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Navigation,
  Camera,
  Car,
  Waves,
  CloudRain,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
  Sparkles,
  MapPin,
  Clock,
  Compass,
  Newspaper,
  ExternalLink,
} from "lucide-react";
import { LiquidGlassCard } from "../components/ui/LiquidGlassCard";
import { CityScene } from "../components/spatial/CityScene";
import { ObservationImage } from "../components/spatial/ObservationImage";
import { useLiveObservations } from "../hooks/useLiveObservations";
import { cameraObservationStatus, currentRain, currentTide, observationTime } from "../lib/observations";
import { getCameraImageUrl, getCameraAnalyzedImageUrl, fetchTrafficNewsHighlights } from "../services/api";
import type { TrafficNewsItem } from "../types/contracts";

const chapters = [
  "Thành phố & Mưa ngập",
  "Mắt thần 796 Camera",
  "Bản tin giao thông",
  "Lộ trình tránh ngập",
];

export default function LandingPage() {
  const track = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [newsHighlights, setNewsHighlights] = useState<TrafficNewsItem[]>([]);
  const live = useLiveObservations();

  useEffect(() => {
    fetchTrafficNewsHighlights(3)
      .then((res) => {
        if (res?.items?.length) setNewsHighlights(res.items);
      })
      .catch(() => {});
  }, []);

  const camera =
    live.cameras.find((c) => c.cam_id === selectedId) ||
    live.cameras.find((c) => c.has_image && c.model_status === "INFERENCE_COMPLETED") ||
    live.cameras.find((c) => c.has_image) ||
    live.cameras[0] ||
    null;

  const status = camera ? cameraObservationStatus(camera, live.now) : "UNAVAILABLE";
  const hasImage = !!camera?.has_image && status !== "UNAVAILABLE";
  const hasAnalysis = hasImage && camera?.model_status === "INFERENCE_COMPLETED";
  const rain = currentRain(live.weather, live.now);
  const tide = currentTide(live.weather, live.now);
  const scene = progress < 0.25 ? 0 : progress < 0.55 ? 1 : progress < 0.8 ? 2 : 3;

  const revision = encodeURIComponent(camera?.retrieved_at || camera?.updated_at || "");
  const timestamp = live.summary?.last_scheduler_cycle;

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = track.current;
        if (element) {
          setProgress(
            Math.max(
              0,
              Math.min(
                1,
                -element.getBoundingClientRect().top / Math.max(1, element.offsetHeight - innerHeight)
              )
            )
          );
        }
      });
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, []);

  function jump(index: number) {
    const points = [0, 0.28, 0.58, 0.85];
    window.scrollTo({
      top:
        (track.current?.offsetTop || 0) +
        points[index] * ((track.current?.offsetHeight || 3000) - innerHeight),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  const snapshot = camera && hasImage ? `${getCameraImageUrl(camera.cam_id)}?v=${revision}` : null;
  const analyzed =
    camera && hasAnalysis
      ? `${getCameraAnalyzedImageUrl(camera.cam_id)}&v=${encodeURIComponent(camera.analyzed_at || revision)}`
      : null;

  return (
    <main className="spatial-landing real-observatory relative selection:bg-indigo-600 selection:text-white">
      {/* Background Aurora Orbs */}
      <div className="fixed top-[-15%] left-[-10%] w-[55vw] h-[55vw] rounded-full bg-gradient-to-br from-indigo-200/40 via-ice-200/30 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-[-15%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tl from-lavender-200/40 via-sky-200/30 to-transparent blur-3xl pointer-events-none -z-10" />

      {/* Primary Navigation Pill */}
      <nav className="landing-nav liquid-pill" aria-label="Điều hướng chính">
        <Link className="spatial-brand" href="/">
          <div className="p-1.5 bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 rounded-xl shadow-md text-white">
            <Navigation size={18} />
          </div>
          <span className="font-black text-ink-950">
            SafePath<span className="text-indigo-600">AI</span>
          </span>
        </Link>
        <span className="nav-live">
          TP.HCM · <span data-testid="network-count" className="font-bold text-ink-900">{live.summary?.total_registered ?? "796"}</span> CAMERA GIÁM SÁT
        </span>
        <div className="nav-links">
          <button onClick={() => jump(1)}>Mắt thần Camera</button>
          <button onClick={() => jump(2)}>Bản tin giao thông</button>
          <Link href="/news" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 transition flex items-center gap-1">
            Bản tin <ArrowUpRight size={12} />
          </Link>
          <button onClick={() => jump(3)}>Điều hướng</button>
        </div>
        <Link href="/map" className="nav-cta">
          Bắt đầu ngay <ArrowUpRight size={16} />
        </Link>
      </nav>

      {/* Story Track with 4 Scenes */}
      <div className="story-track" ref={track}>
        <div className="story-viewport" data-scene={scene}>
          <CityScene cameras={live.cameras} camera={camera} scene={scene} />
          <div className="observatory-shade" />
          <div className="scene-coordinate">
            TP. HỒ CHÍ MINH
            <span>MẠNG LƯỚI ĐIỀU HƯỚNG TRÁNH NGẬP THỰC TẾ</span>
          </div>

          {live.errors.length > 0 && (
            <div className="observatory-error liquid-island" role="alert">
              Không tải được: {live.errors.join(", ")}.
              <button onClick={live.refresh}>Thử lại</button>
            </div>
          )}

          {/* SCENE 0: Hero — Mưa ngập TP.HCM & Lựa chọn lộ trình an toàn */}
          <section
            className={`story-scene hero-scene ${scene === 0 ? "is-active" : ""}`}
            aria-hidden={scene !== 0}
            ref={(el) => {
              el?.toggleAttribute("inert", scene !== 0);
            }}
          >
            <div className="hero-copy">
              <span className="eyebrow">ĐIỀU HƯỚNG THÔNG MINH · TRÁNH NGẬP TP.HCM</span>
              <h1>
                Nhìn rõ thành phố.
                <br />
                <span>Chủ động lối đi an toàn.</span>
              </h1>
              <p>
                Bản đồ giao thông đầu tiên tại TP.HCM kết hợp mạng lưới 796 camera thực tế,
                dự báo lượng mưa từng khu vực và dữ liệu triều cường sông Sài Gòn.
              </p>
              <p className="hero-detail">
                Không còn nỗi lo xe chết máy giữa đường ngập hay kẹt xe hàng giờ. SafePathAI phân tích
                hình ảnh thực địa để gợi ý cung đường cao ráo, thuận tiện nhất cho bạn.
              </p>
              <Link className="liquid-pill primary-spatial group" href="/map">
                <span>Tìm lộ trình tránh ngập</span>
                <ArrowUpRight size={18} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
              </Link>
              <div className="hero-trust">
                <ShieldCheck size={16} className="text-emerald-600" />
                <span>Dữ liệu thực địa từ Sở GTVT & KTTV · Nguyên tắc Zero-Mock</span>
              </div>
            </div>

            <LiquidGlassCard className="hero-signal">
              <div className="signal-top">
                <span className="font-bold flex items-center gap-1.5 text-xs text-ink-800">
                  <Camera size={16} className="text-indigo-600" /> MẠNG LƯỚI CAMERA TP.HCM
                </span>
                <button
                  onClick={live.refresh}
                  aria-label="Cập nhật dữ liệu"
                  className="p-1 hover:bg-slate-100 rounded-lg transition"
                >
                  <RefreshCw size={13} className="text-slate-500" />
                </button>
              </div>

              <div className="signal-metrics">
                <div>
                  <strong data-testid="recent-image-count" className="text-3xl font-black text-ink-950">
                    {live.summary?.valid_images_count ?? "—"}
                  </strong>
                  <small className="text-[11px] text-ink-500 font-medium">Ảnh chụp nhận trong 15 phút qua</small>
                </div>
              </div>
              <p className="text-[10px] text-ink-400 mt-2">Dữ liệu truyền trực tiếp từ Sở Giao thông Vận tải TP.HCM</p>
              <hr className="my-3 border-slate-200" />
              <div className="live-stat-row">
                <span>Camera đã quét</span>
                <b>{live.summary?.checked_count ?? "—"}</b>
              </div>
              <div className="live-stat-row">
                <span>Đã phân tích xe & lưu thông</span>
                <b>{live.summary?.analyzed_count ?? "—"}</b>
              </div>
              <p className="text-[10px] text-ink-400 mt-2">
                Chu kỳ cập nhật gần nhất: {observationTime(timestamp)}
              </p>
              <Link className="observation-link" href="/monitor">
                Xem toàn bộ 796 camera <ArrowUpRight size={13} />
              </Link>
            </LiquidGlassCard>

            <div className="hero-bottom">
              <span>
                <b>{live.summary?.valid_gps_count ?? "796"}</b>
                Camera có GPS chính xác
              </span>
              <span>
                <b>{live.health?.osrm === "available" ? "Sẵn sàng" : "Đang kiểm tra"}</b>
                Tính toán lộ trình tối ưu
              </span>
              <span>
                <b>{rain === null ? "0.0 mm/h" : `${rain.toFixed(1)} mm/h`}</b>
                Mưa quan trắc thời gian thực
              </span>
            </div>
          </section>

          {/* SCENE 1: Camera & SafePath Vision AI */}
          <section
            className={`story-scene vision-scene ${scene === 1 ? "is-active" : ""}`}
            aria-hidden={scene !== 1}
            ref={(el) => {
              el?.toggleAttribute("inert", scene !== 1);
            }}
          >
            <div className="scene-heading">
              <span className="eyebrow">01 / MẮT THẦN 796 CAMERA THỰC TẾ</span>
              <h2>
                Ảnh từ hiện trường.
                <br />
                <span>SafePath Vision AI phân tích trực quan.</span>
              </h2>
              <label className="camera-selector">
                Chọn camera kiểm tra:
                <select
                  aria-label="Chọn camera quan trắc"
                  value={camera?.cam_id || ""}
                  onChange={(e) => setSelectedId(e.target.value)}
                  disabled={!live.cameras.length}
                >
                  {!live.cameras.length && <option value="">Đang tải danh sách camera...</option>}
                  {live.cameras.map((c) => (
                    <option key={c.cam_id} value={c.cam_id}>
                      {c.name} {c.has_image ? "• Có ảnh" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="vision-cards">
              {/* Card 1: Ảnh gốc */}
              <LiquidGlassCard>
                <div className="signal-top">
                  <span className="font-bold flex items-center gap-1.5 text-xs text-ink-800">
                    <Camera size={16} className="text-indigo-600" /> ẢNH CAMERA GỐC
                  </span>
                  <span className="tiny-badge" data-testid="observation-status">
                    {status === "LIVE" ? "Trực tiếp" : "Bản tin trước"}
                  </span>
                </div>
                <ObservationImage
                  src={snapshot}
                  alt={`Ảnh gốc ${camera?.name || "camera"}`}
                  empty="Chưa có ảnh khả dụng cho camera này"
                />
                <p className="text-[11px] text-ink-600 mt-2">
                  Nhận ảnh: {observationTime(camera?.retrieved_at)}
                </p>
                <p className="text-[10px] text-ink-400">
                  Nguồn dữ liệu: Cổng thông tin Giao thông TP.HCM
                </p>
              </LiquidGlassCard>

              {/* Card 2: AI nhận diện phương tiện */}
              <LiquidGlassCard>
                <div className="signal-top">
                  <span className="font-bold flex items-center gap-1.5 text-xs text-ink-800">
                    <Car size={16} className="text-emerald-600" /> PHÁT HIỆN PHƯƠNG TIỆN
                  </span>
                  <span className="tiny-badge font-bold text-emerald-700 bg-emerald-50">
                    SafePath Vision AI
                  </span>
                </div>
                <ObservationImage
                  src={analyzed}
                  alt={`Phân tích phương tiện ${camera?.name || "camera"}`}
                  empty="Đang tải lớp nhận diện phương tiện..."
                />
                <div className="vision-number">
                  <strong data-testid="observed-vehicle-count">
                    {hasAnalysis ? camera?.vehicle_count ?? 0 : 0} <small>xe quan sát được</small>
                  </strong>
                  <b className="text-xs font-semibold text-emerald-700">Ô tô & Xe máy</b>
                </div>
                <p className="text-[10px] text-ink-500 mt-1">
                  Nhận diện thông minh qua pipeline thích ứng ánh sáng và độ sắc nét.
                </p>
              </LiquidGlassCard>

              {/* Card 3: Mức độ lưu thông & cảnh báo ngập */}
              <LiquidGlassCard>
                <div className="signal-top">
                  <span className="font-bold flex items-center gap-1.5 text-xs text-ink-800">
                    <Waves size={16} className="text-sky-600" /> ĐÁNH GIÁ LƯU THÔNG
                  </span>
                </div>
                <div className="actual-water-status">
                  <CheckCircle size={36} className="text-emerald-500" />
                  <strong className="text-lg font-bold text-ink-950">
                    {camera?.risk_level === "CRITICAL"
                      ? "Cảnh báo ngập / ùn tắc cao"
                      : camera?.risk_level === "MODERATE"
                      ? "Lưu ý di chuyển"
                      : "Tuyến đường thông thoáng"}
                  </strong>
                  <small className="text-xs text-ink-500">
                    Mật độ xe: {camera?.traffic_density_score ? `${Math.round(camera.traffic_density_score * 100)}%` : "Bình thường"}
                  </small>
                </div>
                <p className="text-[10px] text-ink-500 mt-3">
                  Tích hợp trực tiếp vào bộ tính toán lộ trình thông minh của SafePathAI.
                </p>
              </LiquidGlassCard>
            </div>

            <span className="scene-note">
              {camera?.name || "Điểm quan sát giao thông"} · Dữ liệu phản ánh thực trạng hiện trường
            </span>
          </section>

          {/* SCENE 2: Bản tin giao thông thành phố */}
          <section
            className={`story-scene fusion-scene ${scene === 2 ? "is-active" : ""}`}
            aria-hidden={scene !== 2}
            ref={(el) => {
              el?.toggleAttribute("inert", scene !== 2);
            }}
          >
            <div className="scene-heading">
              <span className="eyebrow">02 / BẢN TIN GIAO THÔNG THÀNH PHỐ</span>
              <h2>
                Biết trước những gì đang diễn ra.
                <br />
                <span>Cập nhật giao thông trước mỗi hành trình.</span>
              </h2>
              <p className="text-xs text-ink-600 max-w-lg mx-auto">
                Tổng hợp sự cố giao thông, ngập úng và các điểm thi công từ VnExpress, Tuổi Trẻ và Cổng thông tin giao thông TP.HCM.
              </p>
            </div>

            <div className="environment-grid news-landing-grid">
              {newsHighlights.length > 0 ? (
                newsHighlights.slice(0, 2).map((item) => (
                  <LiquidGlassCard key={item.id} className="news-float-card flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {item.category || "Tin giao thông"}
                        </span>
                        {item.location_confidence !== "UNRESOLVED" && item.lat && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                            <MapPin size={10} />
                            <span>Vị trí xác minh</span>
                          </span>
                        )}
                      </div>

                      {item.image_url && (
                        <div className="h-28 rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80">
                          <img
                            src={item.image_url}
                            alt={item.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}

                      <h3 className="font-bold text-sm text-ink-950 line-clamp-2 leading-snug">
                        {item.title}
                      </h3>
                      <p className="text-xs text-ink-600 line-clamp-2 leading-relaxed">
                        {item.summary}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs mt-2">
                      <span className="text-[11px] text-ink-500 font-medium truncate max-w-[150px]">
                        {item.source_name || "Nguồn tin báo chí"}
                      </span>
                      <a
                        href={item.canonical_url || item.link || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-indigo-600 hover:underline flex items-center gap-1"
                      >
                        <span>Xem nguồn</span>
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </LiquidGlassCard>
                ))
              ) : (
                <LiquidGlassCard className="col-span-2 text-center p-6 space-y-2">
                  <Newspaper size={32} className="mx-auto text-indigo-400" />
                  <h3 className="font-bold text-sm text-ink-950">Đang đồng bộ luồng bản tin TP.HCM</h3>
                  <p className="text-xs text-ink-600">
                    Hệ thống đang nạp thông tin giao thông từ các nguồn báo chí và cơ quan quản lý.
                  </p>
                </LiquidGlassCard>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-4">
              <Link href="/news" className="liquid-pill primary-spatial group shadow-glass">
                <Newspaper size={18} />
                <span>Khám phá bản tin giao thông</span>
                <ArrowUpRight size={18} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
              </Link>

              <div className="observation-context liquid-pill">
                <ShieldCheck size={16} className="text-indigo-600" />
                <span>
                  Mưa quan trắc {rain === null ? "0.0 mm/h" : `${rain.toFixed(1)} mm/h`} · Triều {tide === null ? "—" : `${tide.toFixed(2)} m`}
                </span>
              </div>
            </div>
          </section>

          {/* SCENE 3: Lộ trình thông minh */}
          <section
            className={`story-scene route-scene ${scene === 3 ? "is-active" : ""}`}
            aria-hidden={scene !== 3}
            ref={(el) => {
              el?.toggleAttribute("inert", scene !== 3);
            }}
          >
            <LiquidGlassCard className="route-ready">
              <span className="ready-icon">
                <Navigation size={32} />
              </span>
              <span className="eyebrow">03 / ĐIỀU HƯỚNG THÔNG MINH TRÁNH NGẬP</span>
              <h2>
                Lộ trình tối ưu.
                <br />
                <span>Không còn nỗi lo ngập nước.</span>
              </h2>
              <p className="text-xs sm:text-sm text-ink-600 max-w-md mx-auto">
                Hệ thống tự động so sánh các phương án di chuyển, tránh các cung đường trũng thấp
                dễ ngập và hướng dẫn bằng giọng nói tiếng Việt rõ ràng.
              </p>

              {/* Route Comparison Card with Explicit Simulation Label */}
              <div className="relative route-comparison bg-slate-50/85 rounded-2xl border border-slate-200/80 p-4 my-4 max-w-lg mx-auto shadow-glass-sm">
                <div className="absolute -top-3 left-4 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/80 text-[10px] font-bold text-indigo-700 shadow-sm uppercase tracking-wider">
                  Minh họa cách hoạt động • Mô phỏng so sánh
                </div>
                <div className="text-left space-y-1 mt-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                    Tuyến đường thông thường
                  </span>
                  <strong className="text-base sm:text-lg font-bold text-ink-900 block">Khoảng cách ngắn nhất</strong>
                  <small className="text-[10px] text-rose-600 font-semibold block">
                    ⚠ Thường đi qua vùng trũng thấp có nguy cơ ngập nước
                  </small>
                </div>
                <div className="text-slate-400 font-bold text-xs">VS</div>
                <div className="text-left space-y-1 bg-indigo-50/80 p-2.5 rounded-xl border border-indigo-200/80 mt-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                    Tuyến đề xuất SafePathAI
                  </span>
                  <strong className="text-base sm:text-lg font-bold text-indigo-950 block">Điều hướng ưu tiên độ cao</strong>
                  <small className="text-[10px] text-indigo-700 font-semibold block">
                    ✓ Tối ưu tránh điểm ngập & đối chiếu camera thực địa
                  </small>
                </div>
              </div>

              <Link href="/map" className="liquid-pill primary-spatial group shadow-glass">
                <span>Khám phá tuyến đường của bạn</span>
                <ArrowUpRight size={20} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
              </Link>
            </LiquidGlassCard>
          </section>

          {/* Bottom Interactive Chapter Navigation */}
          <div className="story-bottom">
            <button className="scroll-invite" onClick={() => jump(Math.min(3, scene + 1))}>
              <ArrowDown size={16} />
              <span>CUỘN ĐỂ KHÁM PHÁ TIẾP</span>
            </button>
            <div className="chapter-nav" aria-label="Phân cảnh">
              {chapters.map((label, i) => (
                <button
                  key={label}
                  onClick={() => jump(i)}
                  aria-label={label}
                  aria-current={scene === i ? "step" : undefined}
                >
                  <span>0{i + 1}</span>
                  <i className={scene === i ? "active" : ""} />
                </button>
              ))}
            </div>
            <span className="story-caption">{chapters[scene]}</span>
          </div>

          {/* Progress bar at bottom */}
          <div className="story-progress" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>

      {/* Modern Footer */}
      <footer className="spatial-footer">
        <Link className="spatial-brand" href="/">
          <div className="p-1 bg-gradient-to-tr from-indigo-600 via-blue-600 to-sky-500 rounded-lg text-white">
            <Navigation size={14} />
          </div>
          <span className="font-bold text-ink-950">SafePathAI</span>
        </Link>
        <span>Ứng dụng hỗ trợ điều hướng tránh ngập & theo dõi giao thông TP.HCM</span>
        <Link href="/map" className="font-semibold text-indigo-600 hover:underline flex items-center gap-1">
          Bản đồ trực tiếp <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
