"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Navigation, Camera, ScanLine, Waves, CloudRain, ShieldCheck, Database, RefreshCw } from "lucide-react";
import { LiquidGlassCard } from "../components/ui/LiquidGlassCard";
import { CityScene } from "../components/spatial/CityScene";
import { ObservationImage } from "../components/spatial/ObservationImage";
import { useLiveObservations } from "../hooks/useLiveObservations";
import { cameraObservationStatus, currentRain, currentTide, observationTime } from "../lib/observations";
import { getCameraImageUrl, getCameraAnalyzedImageUrl } from "../services/api";

const chapters = ["Mạng lưới camera", "Ảnh và phân tích", "Mưa và thủy triều", "Tìm tuyến đường"];
export default function LandingPage() {
  const track = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const live = useLiveObservations();
  const camera = live.cameras.find(c => c.cam_id === selectedId) || live.cameras.find(c => c.has_image && c.model_status === "INFERENCE_COMPLETED") || live.cameras.find(c => c.has_image) || live.cameras[0] || null;
  const status = camera ? cameraObservationStatus(camera, live.now) : "UNAVAILABLE";
  const hasImage = !!camera?.has_image && status !== "UNAVAILABLE";
  const hasAnalysis = hasImage && camera?.model_status === "INFERENCE_COMPLETED";
  const rain = currentRain(live.weather, live.now), tide = currentTide(live.weather, live.now);
  const scene = progress < .25 ? 0 : progress < .55 ? 1 : progress < .8 ? 2 : 3;
  const vehicleModel = camera?.vehicle_model_name || live.models?.vehicle_detector.model_name;
  const revision = encodeURIComponent(camera?.retrieved_at || camera?.updated_at || "");
  const timestamp = live.summary?.last_scheduler_cycle;
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = track.current;
        if (element) setProgress(Math.max(0, Math.min(1, -element.getBoundingClientRect().top / Math.max(1, element.offsetHeight - innerHeight))));
      });
    };
    update(); addEventListener("scroll", update, { passive: true }); addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); removeEventListener("scroll", update); removeEventListener("resize", update); };
  }, []);
  function jump(index: number) {
    const points = [0, .28, .58, .85];
    window.scrollTo({ top: (track.current?.offsetTop || 0) + points[index] * ((track.current?.offsetHeight || 3000) - innerHeight), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  const snapshot = camera && hasImage ? `${getCameraImageUrl(camera.cam_id)}?v=${revision}` : null;
  const analyzed = camera && hasAnalysis ? `${getCameraAnalyzedImageUrl(camera.cam_id)}&v=${encodeURIComponent(camera.analyzed_at || revision)}` : null;
  return <main className="spatial-landing real-observatory">
    <nav className="landing-nav liquid-pill" aria-label="Điều hướng chính">
      <Link className="spatial-brand" href="/"><Navigation size={22}/><span>SafePath<span className="mint">AI</span></span></Link>
      <span className="nav-live">TP.HCM · <span data-testid="network-count">{live.summary?.total_registered ?? "—"}</span> CAMERA ĐĂNG KÝ</span>
      <div className="nav-links"><button onClick={() => jump(1)}>Camera</button><button onClick={() => jump(2)}>Thời tiết</button></div>
      <Link href="/map" className="nav-cta">Mở bản đồ <ArrowUpRight size={16}/></Link>
    </nav>
    <div className="story-track" ref={track}><div className="story-viewport" data-scene={scene}>
      <CityScene cameras={live.cameras} camera={camera} scene={scene}/>
      <div className="observatory-shade"/>
      <div className="scene-coordinate">TP. HỒ CHÍ MINH<span>OPENSTREETMAP · CAMERA REGISTRY</span></div>
      {live.errors.length > 0 && <div className="observatory-error liquid-island" role="alert">Không tải được: {live.errors.join(", ")}.<button onClick={live.refresh}>Thử lại</button></div>}
      <section className={`story-scene hero-scene ${scene === 0 ? "is-active" : ""}`} aria-hidden={scene !== 0} ref={el => { el?.toggleAttribute("inert", scene !== 0); }}>
        <div className="hero-copy"><span className="eyebrow">DỮ LIỆU THỰC ĐỊA · NGUỒN GỐC RÕ RÀNG</span>
          <h1>Nhìn rõ thành phố.<br/><span>Chủ động lối đi.</span></h1>
          <p>Camera giao thông. Đường OpenStreetMap.<br/>Thông tin trước mỗi hành trình.</p>
          <p className="hero-detail">Xem ảnh camera và điều kiện thời tiết, tìm tuyến bằng OSRM. Những đoạn chưa có bằng chứng rủi ro được đánh dấu chưa xác minh.</p>
          <Link className="liquid-pill primary-spatial" href="/map">Tìm đường trên bản đồ <ArrowUpRight size={19}/></Link>
          <div className="hero-trust"><ShieldCheck size={15}/><span>Không đồng nhất thiếu dữ liệu với an toàn.</span></div>
        </div>
        <LiquidGlassCard className="hero-signal"><div className="signal-top"><span><Camera size={16}/> MẠNG LƯỚI CAMERA</span><button onClick={live.refresh} aria-label="Cập nhật dữ liệu"><RefreshCw size={14}/></button></div>
          <div className="signal-metrics"><div><strong data-testid="recent-image-count">{live.summary?.valid_images_count ?? "—"}</strong><small>Ảnh nhận trong 15 phút gần đây</small></div></div>
          <p>Thời điểm chụp có thể chưa được nguồn xác minh.</p><hr/>
          <div className="live-stat-row"><span>Đã kiểm tra</span><b>{live.summary?.checked_count ?? "—"}</b></div>
          <div className="live-stat-row"><span>Có kết quả phân tích</span><b>{live.summary?.analyzed_count ?? "—"}</b></div>
          <p>Chu kỳ gần nhất: {observationTime(timestamp)}</p>
          <Link className="observation-link" href="/monitor">Xem từng camera <ArrowUpRight size={13}/></Link>
        </LiquidGlassCard>
        <div className="hero-bottom"><span><b>{live.summary?.valid_gps_count ?? "—"}</b>Camera có tọa độ</span><span><b>{live.health?.osrm === "available" ? "Sẵn sàng" : live.loading ? "Đang kiểm tra" : "Gián đoạn"}</b>Định tuyến OSRM</span><span><b>{rain === null ? "—" : `${rain.toFixed(1)} mm/h`}</b>Mưa · Open-Meteo</span></div>
      </section>
      <section className={`story-scene vision-scene ${scene === 1 ? "is-active" : ""}`} aria-hidden={scene !== 1} ref={el => { el?.toggleAttribute("inert", scene !== 1); }}>
        <div className="scene-heading"><span className="eyebrow">01 / BẰNG CHỨNG CAMERA</span><h2>Ảnh từ hiện trường.<br/><span>Phân tích từ khung hình.</span></h2>
          <label className="camera-selector">Camera đang xem<select aria-label="Chọn camera quan trắc" value={camera?.cam_id || ""} onChange={e => setSelectedId(e.target.value)} disabled={!live.cameras.length}>{!live.cameras.length && <option value="">Chưa tải được danh sách camera</option>}{live.cameras.map(c => <option key={c.cam_id} value={c.cam_id}>{c.code} · {c.name}{c.has_image ? "" : " · chưa có ảnh"}</option>)}</select></label>
        </div>
        <div className="vision-cards">
          <LiquidGlassCard><div className="signal-top"><span><Camera size={16}/> ẢNH GỐC</span><span className="tiny-badge" data-testid="observation-status">{status}</span></div>
            <ObservationImage src={snapshot} alt={`Ảnh gốc ${camera?.name || "camera"}`} empty="Chưa có ảnh khả dụng cho camera này"/>
            <p>Nhận ảnh: {observationTime(camera?.retrieved_at)}</p><p>Chụp ảnh: {observationTime(camera?.captured_at)}</p>
          </LiquidGlassCard>
          <LiquidGlassCard><div className="signal-top"><span><ScanLine size={16}/> {vehicleModel || "MODEL_UNAVAILABLE"}</span><span className="tiny-badge">{hasAnalysis ? "INFERENCE_COMPLETED" : "CHƯA PHÂN TÍCH"}</span></div>
            <ObservationImage src={analyzed} alt={`Phân tích phương tiện ${camera?.name || "camera"}`} empty="Chưa có ảnh phân tích từ mô hình"/>
            <div className="vision-number"><strong data-testid="observed-vehicle-count">{hasAnalysis ? camera?.vehicle_count ?? "—" : "—"} <small>xe trong ảnh</small></strong></div><p>Mô hình: {camera?.vehicle_model_validation || live.models?.vehicle_detector.deployment_validation || "Chưa xác minh"}</p>
          </LiquidGlassCard>
          <LiquidGlassCard><div className="signal-top"><span><Waves size={16}/> PHÂN TÍCH NƯỚC</span></div>
            <div className="actual-water-status"><Waves size={36}/><strong>{hasImage && camera?.flood_model_status === "VERIFIED_ONNX_INFERENCE" && camera.flood_ratio != null ? `${(camera.flood_ratio * 100).toFixed(1)}%` : "Chưa có số đo"}</strong><small data-testid="flood-model-status">{camera?.flood_model_status || live.models?.flood_segmenter.status || "Chưa tải được trạng thái mô hình"}</small></div>
            <p>Tỷ lệ pixel nước không cho biết độ sâu ngập.</p><p>Rủi ro đoạn đường: {camera?.evidence_eligibility === "ROUTING_ELIGIBLE" && status === "LIVE" ? camera.risk_level : "UNKNOWN"}</p>
          </LiquidGlassCard>
        </div><span className="scene-note">{camera?.name || "Chưa chọn camera"} · Ảnh cũ hoặc chưa rõ giờ chụp không dùng để kết luận an toàn hiện tại.</span>
      </section>
      <section className={`story-scene fusion-scene ${scene === 2 ? "is-active" : ""}`} aria-hidden={scene !== 2} ref={el => { el?.toggleAttribute("inert", scene !== 2); }}>
        <div className="scene-heading"><span className="eyebrow">02 / ĐIỀU KIỆN MÔI TRƯỜNG</span><h2>Biết điều đang có.<br/><span>Rõ điều còn thiếu.</span></h2></div>
        <div className="environment-grid">
          <LiquidGlassCard><CloudRain size={28}/><h3>Mưa · Open-Meteo</h3><strong data-testid="observed-rain">{rain === null ? "—" : rain.toFixed(1)} <small>mm/h</small></strong><span>{rain !== null ? "LIVE" : live.weather?.rain_status === "LIVE" ? "STALE" : live.weather?.rain_status || "UNAVAILABLE"}</span><p>Quan trắc: {observationTime(live.weather?.rain_observed_at)}</p>{live.weather?.source_url && <a href={live.weather.source_url} target="_blank" rel="noreferrer">Nguồn thời tiết ↗</a>}</LiquidGlassCard>
          <LiquidGlassCard><Waves size={28}/><h3>Thủy triều{live.weather?.tide_station ? ` · ${live.weather.tide_station}` : ""}</h3><strong data-testid="observed-tide">{tide === null ? "—" : tide.toFixed(2)} <small>m</small></strong><span>{tide !== null ? "LIVE" : live.weather?.tide_status === "LIVE" ? "STALE" : live.weather?.tide_status || "UNAVAILABLE"}</span><p>{tide === null ? "Chưa có bản tin triều đủ mới và đủ nguồn." : `Quan trắc: ${observationTime(live.weather?.tide_observed_at)}`}</p><p>Hệ mốc: {live.weather?.tide_datum || "Chưa xác minh"}</p>{live.weather?.tide_source_url && <a href={live.weather.tide_source_url} target="_blank" rel="noreferrer">Nguồn thủy triều ↗</a>}</LiquidGlassCard>
        </div><div className="observation-context liquid-pill"><ShieldCheck size={16}/>Mưa và triều là dữ liệu bối cảnh, không phải số đo nước trên từng đoạn đường.</div>
      </section>
      <section className={`story-scene route-scene ${scene === 3 ? "is-active" : ""}`} aria-hidden={scene !== 3} ref={el => { el?.toggleAttribute("inert", scene !== 3); }}>
        <LiquidGlassCard className="route-ready"><span className="ready-icon"><Navigation size={32}/></span><span className="eyebrow">03 / ĐỊNH TUYẾN TRÊN MẠNG ĐƯỜNG THỰC</span><h2>Chọn điểm đến.<br/><span>Xem đường đi thực tế.</span></h2><p>Khoảng cách, thời gian và hướng rẽ lấy từ OSRM.<br/>Bằng chứng camera được hiển thị theo từng tuyến.</p>
          <div className="routing-health"><Database size={18}/><span>OSRM: {live.health?.osrm === "available" ? "Đang hoạt động" : "Chưa kết nối"}</span></div><Link href="/map" className="liquid-pill primary-spatial">Chọn điểm đi và điểm đến <ArrowUpRight size={20}/></Link><small className="scene-note">Chưa tìm tuyến: chưa có ETA, so sánh hay kết luận rủi ro.</small>
        </LiquidGlassCard>
      </section>
      <div className="story-bottom"><button className="scroll-invite" onClick={() => jump(Math.min(3, scene + 1))}><ArrowDown size={16}/><span>XEM DỮ LIỆU QUAN TRẮC</span></button><div className="chapter-nav" aria-label="Phân cảnh">{chapters.map((label, i) => <button key={label} onClick={() => jump(i)} aria-label={label} aria-current={scene === i ? "step" : undefined}><span>0{i + 1}</span><i className={scene === i ? "active" : ""}/></button>)}</div><span className="story-caption">{chapters[scene]}</span></div><div className="story-progress" style={{ transform: `scaleX(${progress})` }}/>
    </div></div>
    <footer className="spatial-footer"><Link className="spatial-brand" href="/"><Navigation size={20}/> SafePathAI</Link><span>Dữ liệu có nguồn. Những giới hạn được nói rõ.</span><Link href="/monitor">Quan trắc camera <ArrowUpRight size={15}/></Link></footer>
  </main>;
}
