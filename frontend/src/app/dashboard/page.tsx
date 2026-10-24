"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bookmark, Clock, MapPin, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { PlaceSearchCombobox } from "../../components/PlaceSearchCombobox";
import { observationTime } from "../../lib/observations";
import type { PlaceResult } from "../../types/contracts";

export default function UserDashboardPage() {
  const { user, isAuthenticated, isLoading, savePlace, removeSavedPlace } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [label, setLabel] = useState("Khác");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function createPlace(event: React.FormEvent) {
    event.preventDefault();
    if (!place || !isAuthenticated || busy) return;
    setBusy(true); setError(null);
    try {
      await savePlace({ name: place.name, address: place.display_name, lat: place.lat, lng: place.lng, label });
      setShowAdd(false); setQuery(""); setPlace(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không lưu được địa điểm."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setError(null);
    try { await removeSavedPlace(id); } catch { setError("Không xóa được địa điểm. Vui lòng thử lại."); }
  }
  return <div className="spatial-aux min-h-screen">
    <header className="glass-panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="flex items-center gap-3"><Link href="/map" aria-label="Quay lại bản đồ"><ArrowLeft size={19}/></Link><h1 className="font-semibold">Bảng tin & Lộ trình SafePathAI</h1></div>
      <nav className="flex gap-5 text-xs"><Link href="/map">Bản đồ</Link><Link href="/monitor">Giám sát camera</Link><Link href="/account">Tài khoản</Link></nav>
    </header>
    <main className="mx-auto max-w-5xl space-y-6 p-5 md:p-8">
      <div className="glass-panel rounded-3xl p-6"><h2 className="text-xl font-semibold">{user ? `Xin chào, ${user.name}` : "Hành trình của bạn"}</h2><p className="mt-3 text-sm text-slate-400">{isLoading ? "Đang tải hồ sơ…" : user ? "Địa điểm và lịch sử được lưu trong tài khoản của bạn." : "Đăng nhập để xem địa điểm đã lưu và lịch sử tìm đường."}</p>{!isAuthenticated && <Link className="mt-4 inline-block underline text-sm" href="/account">Đăng nhập tài khoản</Link>}</div>
      {error && <p role="alert" className="rounded-2xl border border-rose-400/30 p-4 text-sm text-rose-200">{error}</p>}
      <section className="glass-panel rounded-3xl p-6 space-y-5">
        <div className="flex justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Bookmark size={17}/>Địa điểm yêu thích (1-Click tìm đường)</h2>{isAuthenticated && <button className="flex gap-2 text-xs" onClick={() => setShowAdd(!showAdd)}><Plus size={15}/>Thêm địa điểm</button>}</div>
        {showAdd && <form onSubmit={createPlace} className="space-y-4">
          <label className="flex items-center gap-3 text-xs">Nhãn<select value={label} onChange={event => setLabel(event.target.value)} className="rounded-xl border border-white/20 p-2"><option>Nhà</option><option>Cơ quan</option><option>Trường học</option><option>Khác</option></select></label>
          <PlaceSearchCombobox label="Tìm địa chỉ để lưu" placeholder="Chọn địa chỉ từ kết quả tìm kiếm…" color="emerald" value={query} onChangeText={text => { setQuery(text); setPlace(null); }} selectedCoordinates={place ? { lat: place.lat, lng: place.lng } : null} onSelectPlace={setPlace} ariaLabel="Địa chỉ cần lưu"/>
          {place && <p className="text-xs text-slate-400">{place.display_name} · {place.lat.toFixed(5)}, {place.lng.toFixed(5)}</p>}
          <button className="aurora-btn-primary rounded-xl px-4 py-2 text-xs disabled:opacity-40" disabled={!place || busy}>{busy ? "Đang lưu…" : "Lưu địa điểm"}</button>
        </form>}
        <div className="grid gap-3 sm:grid-cols-2">{(user?.savedPlaces || []).map(item => <div key={item.id} className="rounded-2xl border border-white/15 p-4 flex items-center justify-between gap-3"><div><span className="flex items-center gap-2 text-xs text-slate-400"><MapPin size={14}/>{item.label}</span><p className="mt-2 text-sm">{item.name}</p></div><div className="flex gap-3"><Link href={`/map?origin=${item.lat},${item.lng}`} aria-label={`Tìm đường từ ${item.name}`}><ArrowRight size={16}/></Link><button aria-label={`Xóa ${item.name}`} onClick={() => remove(item.id)}><Trash2 size={16}/></button></div></div>)}</div>
        {!user?.savedPlaces.length && <p className="text-sm text-slate-400">Chưa có địa điểm đã lưu.</p>}
      </section>
      <section className="glass-panel rounded-3xl p-6 space-y-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Clock size={17}/>Lịch sử tìm đường</h2>
        {(user?.history || []).map(item => <div key={item.id} className="border-t border-white/15 pt-4"><p className="text-sm">{item.originName} → {item.destName}</p><p className="mt-2 text-xs text-slate-400">{item.distanceKm.toFixed(1)} km · {item.durationMins.toFixed(0)} phút theo OSRM · {observationTime(item.timestamp)}</p></div>)}
        {!user?.history.length && <p className="text-sm text-slate-400">Chưa có lịch sử tìm đường.</p>}
      </section>
    </main>
  </div>;
}
