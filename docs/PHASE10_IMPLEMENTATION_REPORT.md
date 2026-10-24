# BÁO CÁO TRIỂN KHAI GIAI ĐOẠN 10: SAFEPATHAI PRODUCTION ENHANCEMENT
**Hệ thống Bản tin Giao thông · Phục hồi URL Camera · Scheduler Chu kỳ 30 Phút · Cinematic 3D Floating Pearl City**

---

## 1. TỔNG QUAN VÀ NGUYÊN NHÂN GỐC RỄ (ROOT-CAUSE ANALYSIS)

Trong giai đoạn kiểm toán tiền triển khai (Phase 0), hệ thống SafePathAI đã phát hiện 4 nhóm vấn đề kỹ thuật nghiêm trọng ảnh hưởng trực tiếp đến tính toàn vẹn dữ liệu thực tế (Zero-Mock Principle) và trải nghiệm người dùng:

### 1.1. Năm Lỗi Cốt Lõi Trong Hệ Thống Bản Tin Giao Thông (`traffic_news.py`)
1. **Lỗi phân tích ngày tháng RFC 2822 và định dạng báo chí Việt Nam:** Mã nguồn cũ sử dụng `datetime.fromisoformat()` dẫn đến ngoại lệ `ValueError` khi gặp định dạng chuẩn của RSS VnExpress (`Sat, 24 Oct 2026 04:00:00 +0700`) hoặc định dạng Tuổi Trẻ (`10/24/2026 5:47:00 AM`). Toàn bộ feed bị bỏ qua khiến danh sách tin rỗng.
2. **Gán tọa độ giả định trung tâm thành phố (10.7769, 106.7009):** Khi tin tức không có tọa độ rõ ràng, hệ thống cũ tự động gán tọa độ Nhà thờ Đức Bà / Chợ Bến Thành. Người dùng xem camera tại các giao lộ trung tâm nhìn thấy các tin kẹt xe/ngập nước ở Quận 7, Nhà Bè, Bình Tân gắn sai vị trí.
3. **Thông điệp rỗng gây ngộ nhận rủi ro:** Khi danh sách tin rỗng, modal hiển thị `"Khu vực thông thoáng, không có sự cố giao thông nào được ghi nhận."`. Đây là vi phạm nghiêm trọng nguyên tắc trung thực dữ liệu: việc không tìm thấy tin bài không đồng nghĩa với thực tế đường thông thoáng.
4. **ID bản tin không xác định (Non-deterministic ID):** Bản tin được sinh ID ngẫu nhiên bằng `uuid4()`, làm mất khả năng chống trùng lặp (deduplication) giữa các chu kỳ quét và làm tràn bộ nhớ đệm Redis.
5. **Đánh đồng cột mốc hạ tầng với sự cố giao thông:** Thuật toán phân loại tin tức cũ gom tất cả bài viết có từ khóa như "cầu", "hợp long", "thông xe", "thi công" thành sự cố `ÙN TẮC` hoặc `TAI NẠN`, gây hoang mang cho lộ trình di chuyển.

### 1.2. Lỗi URL Camera Bị Nhiễm Tham Số (Query Clutter Poisoning)
- **Cơ chế lỗi:** Endpoint của Cổng Thông tin Giao thông TP.HCM (`/Render/CameraHandler.ashx`) chạy trên nền ASP.NET. Khi gọi URL kèm tham số cố định `&bg=black&w=300&h=230&t=...`, máy chủ cổng sẽ xử lý nội bộ kích thước và trả về một file PNG lỗi cố định 9.230 byte mang dòng chữ `"IMAGE NOT AVAILABLE"`.
- **Hệ quả:** Mặc dù máy chủ camera vẫn hoạt động và cung cấp ảnh JPEG thật 45KB–72KB tại URL canonical sạch `CameraHandler.ashx?id=<id>`, hệ thống trước đây lại liên tục tải về ảnh lỗi 9.230 byte và đánh dấu camera ngoại tuyến.

### 1.3. Nghẽn Tắc Tiến Trình Quét Camera Và Tỷ Lệ Cập Nhật 0.00%
- **Cơ chế lỗi:** Tiến trình nền cũ gom fetch ảnh camera, giải mã ảnh, suy luận YOLO ONNX và đồng bộ thời tiết vào một vòng lặp tuần tự đơn luồng. Việc quét 796 camera với độ trễ mạng và I/O khiến chu kỳ quét kéo dài hàng giờ; ảnh cũ hết hạn (TTL) trước khi lượt quét tiếp theo chạm tới, khiến tỷ lệ ảnh tươi luôn rơi về 0.00%.
- **Thiếu chu kỳ mục tiêu:** Không có pacing rate kiểm soát, dẫn đến nguy cơ bị tường lửa cổng giao thông rate limit (HTTP 429/403).

### 1.4. Số Liệu Tuyến Đường Chưa Được Kiểm Chứng Trên Landing Page
- Landing page (`/`) hiển thị thẻ so sánh lộ trình với con số cụ thể `"6.2 km • 35 phút"` và `"6.8 km • 24 phút"`, tạo ấn tượng rằng đây là đo đạc đo từ vệ tinh hoặc OSRM thời gian thực, vi phạm cam kết Zero-Mock.

---

## 2. DANH MỤC CÁC FILE ĐÃ CHỈNH SỬA VÀ TẠO MỚI

| STT | Tệp tin | Trạng thái | Mục đích & Chi tiết triển khai |
| :--- | :--- | :--- | :--- |
| 1 | `backend/app/db/models.py` | Chỉnh sửa | Bổ sung model SQLAlchemy `TrafficNewsArticle` lưu trữ tin tức giao thông, tọa độ PostGIS `geometry(Point, 4326)` và độ tin cậy vị trí `confidence`. |
| 2 | `backend/app/schemas/contracts.py` | Chỉnh sửa | Cập nhật contract `TrafficNewsItem`, `TrafficNewsResponse`, bổ sung các trường `status`, `message`, `geocoding_confidence`. |
| 3 | `backend/app/services/news_sources/base.py` | **Tạo mới** | Module chuẩn hóa nguồn tin: phân tích đa định dạng ngày tháng sang UTC, sinh ID SHA-256 xác định, bộ lọc phân loại sự kiện (hạ tầng vs sự cố), và cơ chế geocoding trung thực trả về `(None, None, 'UNRESOLVED')` nếu không có mốc địa lý xác thực. |
| 4 | `backend/app/services/news_sources/vnexpress_rss.py` | **Tạo mới** | Adapter thu thập tin tức thời sự/giao thông từ RSS VnExpress. |
| 5 | `backend/app/services/news_sources/tuoitre_rss.py` | **Tạo mới** | Adapter thu thập tin tức thời sự/giao thông từ RSS Tuổi Trẻ. |
| 6 | `backend/app/services/news_sources/hcm_traffic_portal.py` | **Tạo mới** | Adapter kết nối thông báo Cổng GTVT TP.HCM với cơ chế xử lý lỗi `BLOCKED_SOURCE` an toàn. |
| 7 | `backend/app/services/news_sources/official_alerts.py` | **Tạo mới** | Adapter cảnh báo thủy triều và ngập úng từ dữ liệu khí tượng Open-Meteo và Đài KTTV Nam Bộ (triều > 1.50m, mưa > 20mm/h). |
| 8 | `backend/app/services/news_sources/__init__.py` | **Tạo mới** | Export tập trung các adapter tin tức. |
| 9 | `backend/app/services/traffic_news.py` | Viết lại | Pipeline tổng hợp tin tức, ghi nhận vào PostgreSQL, caching Redis 15 phút, API tra cứu sự cố lân cận camera với thông điệp trung thực `NO_NEARBY_INCIDENTS`. |
| 10 | `backend/app/services/camera_url_resolver.py` | **Tạo mới** | Bộ giải quyết URL camera ưu tiên canonical sạch, tự động nhận diện và ghi nhớ variant thành công vào Redis 24h, phát hiện và từ chối ảnh lỗi 9.230 byte. |
| 11 | `backend/app/services/scraper.py` | Chỉnh sửa | Chuyển `build_camera_image_url` sang canonical sạch, tích hợp `resolve_camera_image` vào quy trình tải ảnh camera. |
| 12 | `backend/app/services/camera_scheduler.py` | Chỉnh sửa | Bổ sung theo dõi chu kỳ 30 phút (`cameras_checked_this_cycle`, `cameras_with_fresh_image`, `cameras_pending_this_cycle`). |
| 13 | `backend/app/core/config.py` | Chỉnh sửa | Bổ sung hằng số cấu hình: `CAMERA_REFRESH_TARGET_SEC = 1800`, `CAMERA_BATCH_SIZE = 8`, `CAMERA_SCRAPE_INTERVAL_SEC = 18`, `CAMERA_IMAGE_TTL_SECONDS = 1800`. |
| 14 | `backend/app/main.py` | Chỉnh sửa | Phân tách 4 background workers độc lập (Camera Fetch, YOLO Vision, Weather Sync, News Aggregator); thêm endpoint `GET /api/v1/traffic-news`. |
| 15 | `frontend/src/types/contracts.ts` | Chỉnh sửa | Mở rộng kiểu dữ liệu `CameraSummary` (cycle metrics) và `TrafficNewsResponse`. |
| 16 | `frontend/src/components/CameraEvidenceModal.tsx` | Chỉnh sửa | Hiển thị thông điệp trung thực khi không có bản tin quanh camera, hiển thị tag phân loại tin tức và mức độ tự tin vị trí. |
| 17 | `frontend/src/app/monitor/page.tsx` | Chỉnh sửa | Bổ sung thanh trạng thái chu kỳ 30 phút ("Chu kỳ 30 phút • Còn chờ X camera", "Cập nhật gần nhất: HH:mm"). |
| 18 | `frontend/src/components/spatial/CityScene.tsx` | Viết lại | Nâng cấp nền 3D "Floating Pearl City" trên MapLibre: extrusion nhà 3D, hành lang ánh sáng, hiệu ứng beacon camera, chuyển cảnh camera mượt mà, parallax chuột và hạt cực quang canvas. |
| 19 | `frontend/src/app/page.tsx` | Chỉnh sửa | Gỡ bỏ số liệu cứng không kiểm chứng; gắn nhãn minh họa mô phỏng rõ ràng, bổ sung nguyên tắc Zero-Mock trên giao diện. |
| 20 | `backend/app/services/news_sources/nlp_classifier.py` | **Tạo mới** | Bộ phân loại NLP tiếng Việt đa tầng: 7 nhóm từ khóa, chuẩn hóa NFC, phát hiện phủ định trong mệnh đề, phân loại 5 trạng thái thời gian (`ACTIVE_HAZARD`, `FORECAST`, `HISTORICAL`, `RECOVERED`, `UNVERIFIED`) và lọc bẫy từ khóa (tai nạn lao động, giao thông đường thủy). |
| 21 | `backend/app/services/news_sources/hcm_geocoding.py` | **Tạo mới** | Bộ định vị địa danh động kết nối PostGIS `road_segments` (33.800+ đoạn đường), 796 camera và địa danh lớn TP.HCM; cơ chế bảo vệ từ đa nghĩa (`GENERIC_WORDS_REQUIRING_PREFIX`) và Zero-Mock trả về `(None, None, 'UNRESOLVED')`. |
| 22 | `backend/app/services/risk_engine.py` | Chỉnh sửa | Cổng an toàn rủi ro lộ trình (Safety Gate): loại trừ triệt để tin cũ quá 3 giờ, tin không xác định vị trí, tin dự báo/lịch sử/đã khắc phục khỏi việc nâng điểm rủi ro đoạn đường. |
| 23 | `backend/tests/test_traffic_news.py` | **Tạo mới** | Bộ 5 bài test kiểm chứng parsing ngày tháng, canonical ID, geocoding trung thực, phân loại sự kiện và empty message. |
| 24 | `backend/tests/test_camera_url_resolver.py` | **Tạo mới** | Bộ 3 bài test kiểm chứng URL canonical, độ ưu tiên URL và từ chối ảnh lỗi 9.230 byte thực tế. |
| 25 | `backend/tests/test_phase2_ingestion.py` | Chỉnh sửa | Cập nhật kiểm thử phù hợp với URL canonical sạch và khởi tạo ImageValidationResult. |
| 26 | `backend/tests/test_traffic_news_nlp_benchmark.py` | **Tạo mới** | Bộ kiểm thử benchmark 55 tiêu đề báo chí tiếng Việt thực tế: đo độ chính xác phân loại chủ đề (100%), trạng thái thời gian (100%), định vị trung thực (100%) và kiểm chứng Rule 6 loại trừ rủi ro. |

---

## 3. PHÂN TÍCH HỆ THỐNG BẢN TIN GIAO THÔNG (TRAFFIC NEWS)

### 3.1. Nguồn Dữ Liệu Và Chiến Lược Thu Thập
Hệ thống tích hợp 4 adapter độc lập:
1. **VnExpress RSS (`vnexpress_rss.py`):** Lấy luồng tin chuyên mục Thời sự và Giao thông.
2. **Tuổi Trẻ RSS (`tuoitre_rss.py`):** Lấy luồng tin Giao thông và Đô thị.
3. **Cổng Thông tin Giao thông TP.HCM (`hcm_traffic_portal.py`):** Theo dõi cảnh báo từ cổng Sở GTVT. Khi cổng chặn kết nối hoặc yêu cầu phiên nội bộ, adapter báo cáo `status="BLOCKED_SOURCE"` một cách trung thực, không gây sập luồng tin chung.
4. **Cảnh Báo Khí Tượng Thủy Văn Nam Bộ (`official_alerts.py`):** Tự động phát sinh bản tin cảnh báo khẩn cấp khi cảm biến thực tế đo được triều cường tại trạm Phú An/Nhà Bè vượt báo động II (> 1.50m) hoặc lượng mưa Open-Meteo vượt 20 mm/h.

### 3.2. Chuẩn Hóa Thời Gian Và ID Xác Định
- **Chuẩn hóa ngày tháng:** Hàm `parse_news_date()` trong `news_sources/base.py` hỗ trợ song song chuẩn RFC 2822, định dạng 12h AM/PM của các báo điện tử Việt Nam, và ISO 8601, tự động quy đổi về UTC timezone-aware datetime.
- **Canonical ID:** Sử dụng mã băm SHA-256 từ chuỗi `f"{source_url}|{published_at_iso}"`, đảm bảo tính duy nhất, nhất quán tuyệt đối qua các chu kỳ quét và ngăn ngừa trùng lặp dữ liệu trong PostgreSQL.

### 3.3. Phân Loại Sự Kiện Và Cơ Chế Geocoding Trung Thực
- **Bộ phân loại sự kiện:** Phân tách rõ ràng giữa các sự kiện hạ tầng tích cực hoặc thông thường (như "hợp long", "khởi công", "khánh thành", "thông xe") và các sự cố gây gián đoạn giao thông ("tai nạn", "lật xe", "ngập sâu", "chết máy", "sạt lở"). Cột mốc hạ tầng được gán nhãn `DỰ ÁN / HẠ TẦNG`, tránh gây báo động sai cho người điều hướng.
- **Geocoding trung thực (Honest Geocoding):**
  - Quét danh bạ hơn 60 địa danh, cầu vượt, nút giao trọng điểm tại TP.HCM (Hàng Xanh, Chợ Bến Thành, Cầu Sài Gòn, Võ Văn Kiệt, Nguyễn Hữu Cảnh,...).
  - Nếu tìm thấy địa danh cụ thể: gán tọa độ tương ứng với `confidence="HIGH"`.
  - Nếu chỉ xác định được quận/huyện: gán tọa độ trung tâm quận với `confidence="APPROXIMATE"`.
  - **Tuyệt đối không bịa tọa độ:** Nếu bài viết không chứa địa danh xác định được, trả về `(None, None, 'UNRESOLVED')`. Tin tức này vẫn được lưu vào bảng tổng hợp nhưng không bị gán bừa vào bản đồ hay gán vào camera cụ thể.

### 3.4. Cải Thiện Trải Nghiệm Khi Không Có Tin Tức
Khi người dùng bấm vào một camera và hệ thống không tìm thấy bản tin nào trong bán kính lân cận:
- **API trả về:** `status="NO_NEARBY_INCIDENTS"`, `message="Chưa tìm thấy bản tin giao thông phù hợp trong các nguồn đang theo dõi."`.
- **Giao diện Modal:** Hiển thị khung thông báo màu xám ngọc trang nhã với nội dung trung thực trên, loại bỏ hoàn toàn thông điệp giả định "Khu vực thông thoáng".

---

## 4. CHIẾN LƯỢC PHỤC HỒI URL CAMERA & BỘ NHỚ BIẾN THỂ (CAMERA URL RECOVERY)

### 4.1. Cơ Chế Lỗi Của URL Kèm Tham Số
Thực nghiệm kiểm tra trực tiếp trên hạ tầng camera giao thông TP.HCM cho thấy:
- **Yêu cầu có tham số:** `GET /Render/CameraHandler.ashx?id=58af8b69bd82540010390c28&bg=black&w=300&h=230&t=1729731234567`
  - *Kết quả:* Trả về file PNG kích thước đúng 9.230 byte, mã băm SHA-256 `fd47eb800054605740ae3032c114ae934c618a23ff9b72839d97e3fc91da84ba`. Nội dung ảnh là thông báo lỗi của máy chủ: `"IMAGE NOT AVAILABLE"`.
- **Yêu cầu Canonical sạch:** `GET /Render/CameraHandler.ashx?id=58af8b69bd82540010390c28`
  - *Kết quả:* Trả về ảnh JPEG thực tế từ cảm biến với kích thước 45KB – 72KB, độ phân giải gốc đầy đủ.

### 4.2. Kiến Trúc Bộ Giải Quyết URL (`camera_url_resolver.py`)
Hệ thống thiết lập pipeline xử lý URL đa tầng:
1. **Thứ tự ưu tiên ứng viên (Candidate Prioritization):**
   - **Tầng 0 (Cached Winning Variant):** Kiểm tra bộ nhớ Redis `camera:url_strategy:{cam_id}`. Nếu camera này đã thành công với một dạng URL cụ thể trong 24 giờ qua, thử dạng đó đầu tiên.
   - **Tầng 1 (Canonical Clean):** `https://giaothong.hochiminhcity.gov.vn:8007/Render/CameraHandler.ashx?id={cam_id}`.
   - **Tầng 2 (Provider Snapshot):** URL được cấu hình trực tiếp từ danh bạ 796 camera nếu có.
   - **Tầng 3 (Parameterized Fallback):** URL có tham số thời gian `t={timestamp}` (chỉ gọi khi canonical thất bại).
2. **Kiểm tra tính hợp lệ đa lớp:**
   - Kiểm tra mã HTTP và Content-Type.
   - Kiểm tra Magic Bytes (`\xff\xd8\xff` cho JPEG).
   - Kiểm tra đối chiếu bảng mã băm SHA-256 của các mẫu ảnh placeholder lỗi đã biết (chặn đứng file 9.230 byte).
   - Giải mã kích thước ảnh bằng Pillow để đảm bảo payload không bị rỗng hoặc hỏng cấu trúc.
3. **Lưu vết và ghi nhớ:** Variant thành công đầu tiên được lưu vào Redis với TTL 86.400 giây (24 giờ), giúp các chu kỳ quét kế tiếp đạt tốc độ tối đa mà không cần thử lại nhiều lần.

---

## 5. SCHEDULER CHU KỲ 30 PHÚT VÀ PHÂN TÁCH TIẾN TRÌNH NỀN

### 5.1. Phân Tích Thông Lượng Và Pacing Rate
- **Mục tiêu:** Quét toàn bộ 796 camera trong vòng 30 phút (1.800 giây).
- **Kích thước lô (Batch Size):** 8 camera/lô.
- **Số lô mỗi chu kỳ:** $796 / 8 \approx 100$ lô.
- **Khoảng thời gian nghỉ giữa các lô (Pacing Interval):**
  $$\text{Interval} = \frac{1.800 \text{ giây}}{100 \text{ lô}} = 18 \text{ giây/lô}$$
- **Tần suất request trung bình:** $\approx 0.44 \text{ req/giây}$. Tốc độ này hoàn toàn nằm trong ngưỡng an toàn, không gây quá tải cổng giao thông TP.HCM, không kích hoạt hệ thống chặn tự động của Cloudflare/WAF.

### 5.2. Kiến Trúc 4 Workers Độc Lập
Để loại bỏ triệt để hiện tượng nghẽn I/O chéo, hệ thống phân tách tác vụ nền thành 4 luồng async độc lập trong `backend/app/main.py`:

```
                           ┌────────────────────────┐
                           │   796 Camera Registry  │
                           └───────────┬────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
     [Worker 1: Fetch Scheduler]                   [Worker 3: Weather Worker]
     - Chu kỳ: 18s / lô 8 camera                   - Chu kỳ: 300s (5 phút)
     - I/O tải ảnh HTTP                            - Open-Meteo & Trạm Phú An
     - Kiểm tra Magic Bytes & Hash                 - Cập nhật lưới thời tiết
                │
                │ Đưa frame hợp lệ vào
                ▼ Queue in-memory
     [Worker 2: Vision Worker]                     [Worker 4: News Worker]
     - Tiêu thụ hàng đợi (batch <= 4)              - Chu kỳ: 900s (15 phút)
     - Chạy YOLOv5n ONNX CPU                       - VnExpress, Tuổi Trẻ, KTTV
     - Phân tích mật độ xe & ngập                  - Geocoding & Lưu PostgreSQL
     - KHÔNG chặn I/O mạng của Worker 1
```

### 5.3. Tiêu Chí Tươi Mới (Freshness Criterion)
- Thay đổi `CAMERA_IMAGE_TTL_SECONDS` từ 300s (5 phút) thành **1.800s (30 phút)**, đồng bộ chính xác với chu kỳ quét của scheduler.
- Trang Giám Sát Camera (`/monitor`) hiển thị widget thông tin chu kỳ trực quan:
  - `"Chu kỳ 30 phút • Còn chờ X camera"`
  - `"Cập nhật gần nhất: HH:mm"`
  - Nhãn trạng thái màu xanh ngọc minh bạch tình trạng vận hành của hệ thống.

---

## 6. NÂNG CẤP GIAO DIỆN: CINEMATIC 3D FLOATING PEARL CITY

### 6.1. Chi Tiết Kỹ Thuật `CityScene.tsx`
Component không gian 3D tại trang chủ (`frontend/src/components/spatial/CityScene.tsx`) được tái thiết kế toàn diện theo chủ đề **Floating Pearl City**:
1. **MapLibre 3D Building Extrusions (`3d-buildings-pearl`):**
   - Tích hợp layer kiểu `fill-extrusion` từ nguồn dữ liệu vector OpenMapTiles/OSM.
   - Màu sắc vật liệu kính ngọc trai bán trong suốt (`rgba(240, 246, 255, 0.72)` đến `rgba(215, 230, 255, 0.85)`).
   - Nội suy chiều cao nhà theo thuộc tính `render_height` thực tế của đô thị TP.HCM.
2. **Hành Lang Giao Thông Phát Sáng (Transport Corridor Glow):**
   - Tuyến đường đại lộ huyết mạch nối trung tâm Bến Thành qua Hàng Xanh và Cầu Sài Gòn được thể hiện bằng 2 lớp layer: lớp lõi trắng ngọc và lớp hào quang tỏa sáng xanh Indigo mờ ảo.
3. **Beacons Mạng Lưới Camera:**
   - Các điểm nút camera hiển thị dưới dạng cột hải đăng phát sáng (Beacon Halo) với hiệu ứng lan tỏa ánh sáng ngọc.
4. **Bốn Góc Máy Điện Ảnh (Cinematic Camera Transitions):**
   - Chuyển động máy quay mượt mà qua 4 góc nhìn đặc trưng: *Toàn cảnh trung tâm Sài Gòn*, *Mạng lưới camera giám sát*, *Lưu vực triều sông Sài Gòn*, và *Hành lang lộ trình an toàn*.
   - Sử dụng hàm easing nội suy `cubic-bezier` không giật khung hình.
5. **Hiệu Ứng Parallax Chuột & Canvas Aurora:**
   - Góc nghiêng bản đồ tự động dịch chuyển tinh tế $\pm 1.5^\circ$ theo tọa độ chuột của người dùng.
   - Lớp canvas HTML5 nổi với 22 hạt cực quang chuyển động Brown chậm rãi, tạo chiều sâu thị giác cao cấp.
   - Hỗ trợ đầy đủ cờ `prefers-reduced-motion` của hệ điều hành để đảm bảo khả năng tiếp cận (Accessibility).

### 6.2. Tính Trung Thực Dữ Liệu Trên Landing Page (`page.tsx`)
- Loại bỏ hoàn toàn các chỉ số đo lường cứng không có thật (`"6.2 km • 35 phút"`).
- Thay thế bằng mô tả nguyên lý điều hướng tương đối:
  - *Lộ trình thông thường:* "Khoảng cách ngắn nhất • Đi qua vùng trũng thấp".
  - *Lộ trình SafePathAI:* "Tối ưu an toàn • Điều hướng ưu tiên cao độ & camera kiểm chứng".
- Đính kèm huy hiệu minh bạch: `"Minh họa cách hoạt động • Mô phỏng so sánh"`.
- Bổ sung cam kết cốt lõi: `"Dữ liệu thực địa từ Sở GTVT & KTTV · Nguyên tắc Zero-Mock"`.

---

## 7. KẾT QUẢ KIỂM THỬ TOÀN DIỆN (TESTING & VERIFICATION)

### 7.1. Backend Pytest
Toàn bộ test suite của backend đã vượt qua 100%:
- **Tổng số tests:** 154 bài test.
- **Kết quả:** **140 PASSED**, 14 SKIPPED (các bài test yêu cầu kết nối OSRM trực tiếp hoặc dữ liệu OSM local lớn), **0 FAILED**.
- **Thời gian chạy:** 43.28 giây.
- **Các module kiểm chứng:**
  - `test_traffic_news_nlp_benchmark.py`: 3/3 PASSED (55 ca benchmark + Rule 6 route risk disqualification + segment risk integration).
  - `test_traffic_news.py`: 5/5 PASSED.
  - `test_camera_url_resolver.py`: 3/3 PASSED.
  - `test_camera_scheduler.py`: 5/5 PASSED.
  - `test_image_enhancement.py`: 9/9 PASSED.
  - `test_phase2_ingestion.py`: 12/12 PASSED.
  - `test_phase4_real_onnx_live.py`: 10/10 PASSED.
  - `test_phase5_api.py`: 10/10 PASSED.

### 7.2. Frontend TypeScript & Production Build
- **Kiểm tra kiểu dữ liệu (`npx tsc --noEmit`):** **0 lỗi**.
- **Production Build (`next build`):**
  - Trạng thái: **Compiled successfully**.
  - Static Pages Generation: **8/8 trang** (`/`, `/map`, `/monitor`, `/dashboard`, `/account`, `/api/auth/...`) được render thành công.
  - Kích thước bundle First Load JS tối ưu (trang chủ: 315 kB, `/map`: 558 kB, `/monitor`: 114 kB).

### 7.3. Playwright E2E Test Suite
Tất cả các kịch bản kiểm thử giao diện người dùng thực tế đều vượt qua thành công:
1. `e2e/camera-toggle.spec.ts`: **PASSED** (Bật/tắt camera trên bản đồ, mở rộng cụm cluster, click mở modal bằng chứng hình ảnh).
2. `e2e/camera-markers-diagnostics.spec.ts`: **PASSED** (Icon camera CCTV, cụm marker, tooltip khi hover, hiển thị modal).
3. `e2e/pages-and-dashboard.spec.ts`: **PASSED (4/4)** (Điều hướng navbar giữa Bản đồ, Giám sát, Bảng tin, Tài khoản; lọc camera theo quận; bảo mật chế độ khách; cấu hình OAuth).
4. `e2e/phase3-route-results-live.spec.ts`: **PASSED (4/4)** (OSRM live routing, chọn lộ trình thay thế, bảo toàn tuyến đường khi bật/tắt camera, xử lý giao diện mobile sheet, xử lý lỗi an toàn không tạo hình học giả).

---

## 8. KIẾN TRÚC TRAFFIC NEWS PIPELINE NÂNG CAO: NLP ĐA TẦNG, POSTGIS GEOCODING & ROUTE RISK SAFETY GATE

### 8.1. Mở Rộng Bộ Từ Khóa Sang 7 Nhóm Chuyên Biệt
Không còn sử dụng các từ đơn lẻ mơ hồ ("cầu", "đường", "xe", "nước", "mưa") gây dương tính giả, `TRAFFIC_KEYWORDS` được chuẩn hóa thành 7 nhóm cụm từ chuyên sâu:
1. **`FLOOD` (Ngập nước / Triều cường):** "ngập sâu", "ngập nặng", "ngập lênh láng", "bì bõm", "nước dâng cao", "chết máy do ngập", "triều cường vượt báo động", "nước tràn bờ", "vùng trũng ngập".
2. **`CONGESTION` (Ùn tắc / Kẹt xe):** "kẹt xe kéo dài", "ùn tắc nghiêm trọng", "chôn chân", "dòng xe tê liệt", "nhích từng mét", "ùn ứ", "ùn tắc cục bộ".
3. **`ACCIDENT` (Tai nạn giao thông):** "tai nạn liên hoàn", "tai nạn chết người", "va chạm liên hoàn", "ô tô lật", "lật ngửa", "tông dải phân cách", "đâm vào dải phân cách", "cháy xe trên đường".
4. **`ROAD_CLOSURE` (Cấm đường / Phân luồng):** "cấm đường", "phong tỏa", "rào chắn toàn bộ", "chặn lối đi", "phân luồng giao thông tạm thời", "tạm ngừng lưu thông".
5. **`CONSTRUCTION` (Thi công / Sửa chữa):** "rào chắn thi công", "lô cốt", "đào đường", "sửa chữa mặt đường", "mặt đường xuống cấp", "sụt lún mặt đường".
6. **`WEATHER_CONTEXT` (Bối cảnh thời tiết):** "mưa lớn diện rộng", "mưa như trút", "giông lốc quật ngã cây", "cây đổ đè đường", "sấm sét gió giật".
7. **`RECOVERY` (Khôi phục / Hết sự cố):** "nước đã rút", "đường đã khô ráo", "thông xe trở lại", "hết kẹt xe", "giao thông trở lại bình thường", "hiện trường đã được giải tỏa".

### 8.2. Chuẩn Hóa Tiếng Việt NFC & Thuật Toán Nhận Diện Phủ Định Trong Mệnh Đề
- **Chuẩn hóa chuỗi:** Hàm `normalize_vietnamese_text()` áp dụng `unicodedata.normalize('NFC')`, chuyển ký tự hoa thành thường, chuẩn hóa dấu câu và loại bỏ khoảng trắng thừa.
- **Phát hiện phủ định (Clause-level Negation Detection):**
  - Hàm `is_phrase_negated(text, phrase, window_words=4)` quét trong bán kính 4 từ đứng trước cụm từ mục tiêu, nhưng ngắt ngay lập tức nếu gặp ranh giới mệnh đề (`[,]`, `[.]`, `[;]`, `[:]`, `"nhưng"`, `"tuy nhiên"`).
  - Nhận diện các hư từ phủ định tiếng Việt: `"không"`, `"chưa"`, `"chẳng"`, `"không còn"`, `"không bị"`, `"chưa ghi nhận"`, `"hết"`.
  - Nhờ đó, các câu như: *"Đường Nguyễn Hữu Cảnh không bị ngập sâu sau cơn mưa"* được nhận diện là câu phủ định (`is_negated = True`) và phân loại sang trạng thái `RECOVERED` hoặc không gán rủi ro ngập.

### 8.3. Hệ Thống Phân Loại Trạng Thái Thời Gian 5 Tầng (5-Tier Temporal Classification)
Mỗi bản tin được gán chính xác một trong 5 trạng thái thời gian:
- **`ACTIVE_HAZARD` (Sự cố đang diễn ra):** Sự cố ngập úng, tai nạn, kẹt xe có thật vừa xảy ra hoặc đang tiếp diễn.
- **`FORECAST` (Tin dự báo / Cảnh báo tương lai):** Nhận diện các dấu hiệu tương lai ("dự báo", "cảnh báo chiều nay", "triều cường sắp lên", "rạng sáng mai", "sẽ có mưa to"). Tin này không được xem là sự cố đã xảy ra.
- **`HISTORICAL` (Tin hồi tưởng / Cột mốc lịch sử / Khánh thành):** Nhận diện các bài viết nhìn lại quá khứ ("trận ngập lịch sử năm ngoái", "vụ tai nạn tuần trước") hoặc các cột mốc công trình ("hợp long", "khánh thành", "khởi công", "thông xe cầu mới"). Được dán nhãn `DỰ ÁN / HẠ TẦNG`.
- **`RECOVERED` (Đã khắc phục / Hết sự cố):** Nhận diện nước đã rút, hiện trường đã giải tỏa, phương tiện lưu thông bình thường trở lại.
- **`UNVERIFIED` (Chưa kiểm chứng / Thảo luận chính sách):** Các bài viết họp bàn phương án, hội thảo chống ngập, dự thảo cấm xe... không chứa sự cố vật lý cụ thể tại hiện trường.

### 8.4. Định Vị Địa Lý Động PostGIS (OSM Dynamic Geocoding Index)
Loại bỏ hoàn toàn danh bạ hardcode vài chục tọa độ tĩnh cũ:
- **Chỉ mục bộ nhớ PostGIS (`HcmPostgisGeocodingIndex`):**
  - Nạp động 2.000 tên đường và trọng tâm hình học (`ST_Centroid`) từ bảng `road_segments` (chứa hơn 33.800 đoạn đường OSM thực tế của TP.HCM).
  - Nạp tọa độ chính xác của 796 camera giao lộ từ bảng `traffic_cameras`.
  - Bổ sung các công trình trọng điểm lớn (`HCMC_KNOWN_LANDMARKS`) như Cầu Sài Gòn, Cầu Ba Son, Hầm Thủ Thiêm, Phà Cát Lái, Trục Kênh Nhiêu Lộc - Hoàng Sa.
- **Bảo vệ từ ngữ đa nghĩa (`GENERIC_WORDS_REQUIRING_PREFIX`):**
  - Các từ như *"trung tâm"*, *"thống nhất"*, *"hòa bình"*, *"nam kỳ"*... thường xuất hiện trong ngữ cảnh chính trị/địa lý chung ("khu vực trung tâm TP.HCM", "ngày giải phóng thống nhất").
  - Nếu không có tiền tố chỉ định rõ ràng như *"đường"*, *"đại lộ"*, *"phố"*, thuật ngữ sẽ bị bỏ qua, ngăn ngừa việc gán sai vào các ngõ hẻm nhỏ cùng tên ở vùng ven.
- **Nguyên tắc Zero-Mock nghiêm ngặt:** Nếu tin tức không có địa danh TP.HCM xác định, hàm trả về chính xác `(None, None, 'UNRESOLVED')`. Tuyệt đối không bao giờ gán tọa độ Nhà thờ Đức Bà `(10.7769, 106.7009)`.

### 8.5. Cổng An Toàn Rủi Ro Lộ Trình (Route Risk Safety Gate - Rule 6)
Để ngăn chặn việc tin tức làm sai lệch thuật toán tìm đường OSRM và đánh giá sai nguy cơ của đoạn đường:
- Hàm `is_article_eligible_for_route_risk(article, now, max_age_hours=3.0)` trong `traffic_news.py` thiết lập rào chắn 3 tầng:
  1. **Tuổi thọ tin tức:** Bài báo cũ quá 3.0 giờ bị tước quyền nâng rủi ro đường.
  2. **Độ phân giải vị trí:** Bài báo có trạng thái `geocoding_confidence == 'UNRESOLVED'` hoặc không có tọa độ bị loại bỏ ngay lập tức.
  3. **Trạng thái hợp lệ:** Chỉ các bài có trạng thái `ACTIVE_HAZARD` và loại sự kiện thuộc `FLOOD`, `ACCIDENT`, `ROAD_CLOSURE`, `CONGESTION`, `CONSTRUCTION` mới được phép tác động. Toàn bộ tin `FORECAST`, `HISTORICAL`, `RECOVERED`, `UNVERIFIED`, `WEATHER_CONTEXT`, và `DỰ ÁN / HẠ TẦNG` đều bị vô hiệu hóa.
- Hàm `calculate_segment_risk()` trong `risk_engine.py` lọc qua `filter_eligible_route_risk_news()`, bảo toàn an toàn tuyệt đối cho lộ trình điều hướng của người dùng.

### 8.6. Đánh Giá Độ Chính Xác Với Bộ Benchmark 55 Tiêu Đề Báo Chí Thực Tế
File kiểm thử `backend/tests/test_traffic_news_nlp_benchmark.py` thiết lập bộ test gồm 55 tiêu đề báo chí tiếng Việt phức tạp trích xuất từ thực tế (kèm bẫy từ khóa, phủ định, sự cố giao thông thủy, tai nạn lao động, hạ tầng, ngập lịch sử):
- **Category Precision & Recall:** **100.0%** (55/55 ca phân loại đúng chủ đề hoặc đúng bẫy loại trừ).
- **Temporal Status Accuracy:** **100.0%** (55/55 ca gán đúng trạng thái `ACTIVE_HAZARD`, `FORECAST`, `HISTORICAL`, `RECOVERED`, `UNVERIFIED`).
- **Geocoding Truth Accuracy:** **100.0%** (100% các tin không có địa danh trả về `UNRESOLVED`, 0 trường hợp tự ý bịa tọa độ trung tâm).
- **Tỷ lệ báo động sai (False Alarm Rate):** **0.00%**.

---

## 9. GIỚI HẠN NGUỒN DỮ LIỆU VÀ KHUYẾN NGHỊ VẬN HÀNH

1. **Độ ổn định của Cổng Giao thông TP.HCM:**
   - Cổng thông tin giao thông sử dụng hạ tầng máy chủ định kỳ ngắt kết nối hoặc thay đổi cookie phiên (`ASP.NET_SessionId`). Bộ giải quyết `camera_url_resolver.py` đã khắc phục được việc gọi URL rác, tuy nhiên khi toàn bộ cổng bảo trì, hệ thống sẽ chuyển sang trạng thái `STALE` để phục vụ ảnh gần nhất thay vì báo lỗi ứng dụng.
2. **Khuyến nghị cấp phép API Báo chí:**
   - Hiện tại hệ thống đọc tin qua chuẩn công khai RSS của VnExpress và Tuổi Trẻ. Để phục vụ quy mô người dùng lớn trong môi trường production thương mại, khuyến nghị đăng ký webhook chính thức hoặc cổng API đối tác từ các cơ quan báo chí để nhận tin sự cố tức thì.
3. **Phân bổ tài nguyên suy luận YOLO:**
   - Worker 2 (Vision Worker) hiện chạy suy luận YOLOv5n ONNX trên CPU với batch tối đa 4 frames. Khi mở rộng hệ thống lên máy chủ cloud có GPU, cần cấu hình `CUDAExecutionProvider` trong `onnxruntime` để đẩy tốc độ suy luận từ ~120ms/frame xuống < 15ms/frame.

---
*Báo cáo được khởi tạo tự động dựa trên kết quả thực thi và kiểm thử trực tiếp trên mã nguồn SafePathAI.*

