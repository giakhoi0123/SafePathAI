# SAFEPATHAI — PHASE 10 PRE-CHECK & AUDIT REPORT

**Thời điểm kiểm tra:** 2026-10-24 07:20:45 (Local Time)  
**Commit tham chiếu:** `0876f795090a1b1aefe61f486038c7e1ec8b7922` (HEAD: `fea: traffic news`)  
**Trạng thái Working Tree:** Clean (`git status` 0 uncommitted changes trước khi bắt đầu Phase 10).

---

## 1. KIỂM TRA MÔI TRƯỜNG & DỊCH VỤ ĐANG CHẠY

| Dịch Vụ | Cổng (Port) | Trạng Thái Lắng Nghe | Kiểm Tra Endpoint Thực Tế | Ghi Chú |
| :--- | :---: | :---: | :---: | :--- |
| **Backend (FastAPI)** | `8000` | LISTENING (PID 42755/20600) | `HTTP 200` (`/api/v1/health`) | Database, Redis, OSRM đều `healthy` / `available`. |
| **Frontend (Next.js)** | `3000` | LISTENING (PID 22663) | `HTTP 200` (`/`, `/map`, `/monitor`) | Next.js dev server đang phục vụ bình thường. |
| **PostgreSQL (PostGIS)**| `5432` | LISTENING (Docker) | Kết nối TCP active từ FastAPI | Lưu trữ 796 camera nodes, bảng `camera_ingestion_state`. |
| **Redis Cache** | `6379` | LISTENING (Docker) | Kết nối TCP active từ FastAPI | Distributed lease locks, weather cache, feed cache. |

---

## 2. KẾT QUẢ KIỂM TOÁN TỪNG PHÂN HỆ TRƯỚC KHI SỬA

### 2.1. Phân Hệ Bản Tin Giao Thông (`traffic_news.py`)
- **API Hiện Tại:** `GET /api/v1/traffic-news/nearby?lat=10.7769&lng=106.7009` trả về 4 items.
- **5 Lỗi Nghiêm Trọng Được Ghi Nhận Trực Tiếp Từ Log / Code:**
  1. **Lỗi ngày đăng (`published_at`):** `pub_date_str = item.findtext("pubDate")` bị bỏ qua; gán `published_at=datetime.now(timezone.utc)`. Các tin đăng nhiều ngày trước bị biến thành tin vừa xuất bản.
  2. **Bịa tọa độ trung tâm TP.HCM:** `if matched_lat is None: matched_lat = 10.7769; matched_lng = 106.7009`. Mọi bài viết chung chung về TP.HCM (như xe múc lật ở Hoàng Sa, Nhiêu Lộc) bị tự động gán vào tọa độ trung tâm Quận 1.
  3. **Kết luận sai khi không tìm thấy tin:** Khi danh sách rỗng, trả về thông điệp sai sự thật: *"Không có sự cố giao thông nào được ghi nhận gần khu vực này trong 12 giờ qua"*. Phải sửa thành *"Chưa tìm thấy bản tin giao thông phù hợp trong các nguồn đang theo dõi"* và `FEED_UNAVAILABLE` nếu nguồn lỗi.
  4. **ID không ổn định:** Dùng `abs(hash(title)) % 1000000` thay đổi theo tiến trình Python (hash randomization).
  5. **Phân loại sự kiện quá thô sơ:** Cầu đi bộ hợp long bị phân loại thành `ÙN TẮC`.

### 2.2. Phân Hệ Camera URL (`scraper.py`, `CameraHandler.ashx`)
- **Bằng chứng Forensic:** Tại [docs/CAMERA_URL_AUDIT.md](file:///Users/phamgiakhoi/SafePath-Hackathon/docs/CAMERA_URL_AUDIT.md), việc đính kèm các tham số `bg=black&w=300&h=230` trên `CameraHandler.ashx` khiến máy chủ trả về ảnh lỗi PNG 9,230 bytes (`IMAGE NOT AVAILABLE`), trong khi yêu cầu URL tối giản `CameraHandler.ashx?id=<id>` lại trả về ảnh JPEG hợp lệ (dung lượng 45KB-52KB)!
- **Code hiện tại:** `build_camera_image_url(cam_id)` trong `scraper.py` đang cố định chuỗi `&bg=black&w=300&h=230&t={ts_ms}` cho tất cả camera.
- **Giải pháp:** Cần xây dựng `camera_url_resolver.py` với chiến lược ưu tiên: Canonical `CameraHandler.ashx?id=<cam_id>`, lưu lại variant thành công cho từng camera, backoff có kiểm soát.

### 2.3. Phân Hệ Scheduler & Ingestion (`camera_scheduler.py`, `main.py`)
- **Tình trạng:** Worker đang chạy theo vòng lặp dồn cục: Ingestion (batch 8) → Weather/Tide → Sleep `CAMERA_SCRAPE_INTERVAL_SEC`.
- **Yêu cầu mới:**
  - Tách bạch rõ ràng: **Fetch Scheduler** (chu kỳ mục tiêu 30 phút cho toàn bộ 796 camera), **Vision Worker** (tách luồng phân tích AI), **Weather Worker** (chu kỳ freshness riêng), **News Worker** (chu kỳ cập nhật RSS riêng).
  - Tỷ lệ throughput: 796 camera trong 1800 giây = ~0.44 camera/giây (~4 camera mỗi 9 giây, hoặc batch 8 mỗi 18 giây).
  - Cung cấp metrics thân thiện cho người dùng trên `/monitor` (không lộ thuật ngữ kỹ thuật Redis/Worker).

### 2.4. Phân Hệ Giao Diện 3D & Landing (`CityScene.tsx`, `page.tsx`)
- **Hiện tại:** `CityScene.tsx` chỉ dùng MapLibre pitch=40/60 phẳng với circle markers.
- **Chỉ số so sánh hardcoded:** Trong `page.tsx`, thẻ so sánh tuyến đang hardcode cố định "6.2 km • 35 phút" vs "6.8 km • 24 phút" kèm khẳng định "Đường cao ráo, thông thoáng" không có nhãn minh họa. Cần chuẩn hóa nhãn "Minh họa cách hoạt động".
- **Yêu cầu 3D:** Nâng cấp thành **Floating Pearl City** với chiều sâu 3D (3D buildings extrusion, atmospheric fog/haze, aurora light trails, camera motion mượt mà theo scroll/chuột, hỗ trợ `prefers-reduced-motion` và dynamic import).

---

## 3. KẾ HOẠCH TRIỂN KHAI THEO THỨ TỰ ƯU TIÊN

1. **P0 — Phase 1: Sửa API Bản Tin Giao Thông** (`backend/app/services/traffic_news.py`, RFC 2822 date parser, canonical SHA-256 ID, geocoding phân cấp, mở rộng nguồn tin thật, database/cache).
2. **P0 — Phase 2: Camera URL Recovery** (`backend/app/services/camera_url_resolver.py`, tái cấu trúc `scraper.py`, lưu trữ variant thành công).
3. **P1 — Phase 3: Camera Worker 30-Minute Scheduler** (Định cấu hình 1800s full-cycle, tách riêng News/Weather/Fetch/Vision workers, cập nhật SSE/WebSocket event, UI friendly metrics trên `/monitor`).
4. **P2 — Phase 4: Cinematic 3D Background & Landing Truthfulness** (Nâng cấp `CityScene.tsx` với 3D buildings & atmospheric depth, loại bỏ số liệu hardcode không gắn nhãn tại `page.tsx`, tối ưu GPU/mobile).
5. **Phase 5: Kiểm Thử Toàn Diện & Xuất Báo Cáo Nghiệm Thu** (`docs/PHASE10_IMPLEMENTATION_REPORT.md`).

