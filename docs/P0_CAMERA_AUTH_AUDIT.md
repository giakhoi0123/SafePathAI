# SAFEPATHAI — BÁO CÁO KIỂM TOÁN P0 TRƯỚC SỬA LỖI (PRE-CHECK AUDIT)

**Thời gian kiểm toán:** 2026-10-23 23:25:00 (UTC+7)  
**Commit cơ sở:** `131b94934341d08262e6bd81e483734d465eb9af`  
**Môi trường:** Local macOS, Docker (PostGIS 5432, Redis 6379, OSRM 5001), FastAPI 8000, Next.js 3000 / 3100.

---

## 1. Kiểm tra trạng thái kho mã nguồn (Git Status & Worktree)

- **Branch hiện tại:** `main` (đồng bộ với `origin/main` tại commit `131b9493`).
- **Thay đổi chưa commit (Uncommitted changes):**
  - `.env.example`: Thêm các biến cấu hình Image Enhancement.
  - `backend/app/core/config.py`: Cấu hình cờ và tham số cải thiện ảnh.
  - `backend/app/schemas/contracts.py`: Hợp đồng `ImageQualityAssessment`, `ImageQualityMetrics`.
  - `backend/app/services/vision.py`: Bộ thẩm định chất lượng ảnh, pipeline CLAHE/Gamma/Bilateral/Unsharp, dual-path inference.
  - `backend/app/services/routing.py`: Xử lý an toàn khi `httpx.AsyncClient` tái sử dụng trong test.
  - `backend/app/main.py`: Hỗ trợ tham số `?type=enhanced` cho endpoint camera snapshot.
  - `frontend/src/types/contracts.ts`: Cập nhật kiểu dữ liệu chất lượng ảnh.
  - `frontend/src/services/api.ts`: Bổ sung `getCameraEnhancedImageUrl`.
  - `frontend/src/components/CameraEvidenceModal.tsx`: Thẻ toggle ảnh gốc vs ảnh tăng cường, huy hiệu chất lượng.
  - `frontend/src/app/monitor/page.tsx`: Huy hiệu chất lượng camera và nhãn AI+.
  - `backend/tests/test_image_enhancement.py`: 9 bài kiểm thử đơn vị & tích hợp pipeline cải thiện ảnh (100% PASS).
  - `docs/BENCHMARK_IMAGE_ENHANCEMENT.md` & `scripts/benchmark_enhancement.py`: Benchmark trên 8 ảnh thực tế.
- **Cam kết bảo lưu:** Tuyệt đối không xóa hay ghi đè các chức năng đã hoàn thiện trước đó.

---

## 2. Kiểm toán dữ liệu thực tế (Telemetry & Database Verification)

| Chỉ số kiểm tra | Giá trị thực tế | Đánh giá Zero-Mock |
| :--- | :---: | :--- |
| **Tổng số camera trong cơ sở dữ liệu (`traffic_cameras`)** | **796** | Đầy đủ 100% theo bản quyền VDMS Sở GTVT TP.HCM |
| **Camera có tọa độ GPS hợp lệ (PostGIS Point)** | **796 / 796** | 100% có tọa độ WGS84 chuẩn trong địa phận TP.HCM |
| **Camera trạng thái `snapshot_cam_status = 'UP'`** | **654 / 796** | 654 camera hoạt động được ghi nhận trong lịch sử VDMS |
| **Ảnh camera snapshot thực tế trên đĩa (`storage/cams/`)** | **8** | Chỉ có 8 file snapshot được tải về (tất cả là camera đứng đầu) |
| **Bản ghi bằng chứng trong Redis (`camera_evidence:*`)** | **11** | Chỉ 11 camera có bằng chứng suy luận được lưu đệm |
| **Trạng thái kết nối PostGIS (Port 5432)** | `HEALTHY` | Kết nối thành công, không có query timeout |
| **Trạng thái kết nối Redis (Port 6379)** | `HEALTHY` | Phản hồi PONG, pub/sub và stream hoạt động |
| **Trạng thái dịch vụ OSRM (Port 5001)** | `AVAILABLE` | Tìm đường OSRM thật trên đồ thị OSM HCMC |
| **HTTP Trang chủ (`http://localhost:3000/`)** | `200 OK` | Hoạt động bình thường |
| **HTTP Trang Giám sát (`http://localhost:3000/monitor`)** | `200 OK` | Danh sách 796 camera hiển thị |
| **HTTP Trang Tài khoản (`http://localhost:3000/account`)** | `200 OK` | Đang bị lỗi hiển thị mock "Nguyễn Văn An" |

---

## 3. Xác định nguyên nhân gốc rễ (Root Causes)

### 3.1. Vấn đề 1: Lỗi Camera Ingestion Scheduler (P0.1)
- **Vị trí lỗi:** `backend/app/main.py:143-151` trong hàm `background_camera_worker_loop()`.
- **Đoạn mã gây lỗi:**
  ```sql
  SELECT cam_id, source_uri, name, district, ST_Y(geom) AS lat, ST_X(geom) AS lng, ...
  FROM traffic_cameras
  WHERE geom IS NOT NULL
  ORDER BY
      CASE WHEN snapshot_cam_status = 'UP' THEN 0 ELSE 1 END,
      cam_id ASC
  LIMIT 8
  ```
- **Hậu quả:** 
  1. Cố định lặp lại 8 camera đầu tiên theo thứ tự bảng chữ cái (`cam_id ASC`).
  2. 788 camera còn lại không bao giờ có lượt tải ảnh hoặc kiểm tra.
  3. Không có cơ chế lưu vết `last_attempt_at`, `last_success_at`, `failure_count`, `next_retry_at`.
  4. Không có hàng đợi phân tầng ưu tiên (camera người dùng đang xem trên bản đồ / gần lộ trình tuyến đường).
  5. Không có Distributed Lock / Redis Lease nếu chạy song song nhiều worker.

### 3.2. Vấn đề 2: Lỗi Camera Marker & Cluster trên MapLibre (P0.2)
- **Vị trí lỗi:** `frontend/src/components/MapContainer.tsx`.
- **Hậu quả & Cơ chế lỗi:**
  1. **Race Condition cập nhật filter:** Gọi `setCameraFilter(f)` và `updateCameras()` cùng lúc dẫn đến effect đọc state cũ.
  2. **Zoom suppression rỗng layer:** Mã nguồn tự ý xóa GeoJSON features khi map zoom $< 10$ thay vì để MapLibre cluster tự động gộp cụm điểm.
  3. **Lọc `ON_ROUTE` không có hướng dẫn:** Khi người dùng chưa tìm đường mà bật `ON_ROUTE`, bản đồ rỗng hoàn toàn mà không giải thích.
  4. **Không có cơ chế Live Refresh / Invalidation:** Frontend chỉ tải danh sách camera 1 lần khi mount, khi backend cào được ảnh mới thì bản đồ không tự cập nhật trạng thái ảnh.
  5. **Layer visibility & coordinate order:** Cần bảo đảm định dạng GeoJSON `[lng, lat]` chuẩn WGS84 và màu sắc/icon nổi bật theo phong cách Pearl Aurora Liquid Glass.

### 3.3. Vấn đề 3: Lỗi Xác thực Google OAuth giả lập (P0.3)
- **Vị trí lỗi:** `frontend/src/context/AuthContext.tsx` và `frontend/src/app/account/page.tsx`.
- **Mã nguồn vi phạm:**
  ```typescript
  if (!isConfigured) {
    loginDemo();
    return;
  }
  ```
- **Hậu quả:**
  1. Tự sinh người dùng mẫu "Nguyễn Văn An", `an.nguyen@example.com` với ảnh Unsplash và lưu vào `localStorage`.
  2. Báo "Đã đăng nhập" giả mạo trong khi chưa hề có phiên OAuth từ Google.
  3. Thiếu bảng lưu người dùng thực tế trong PostgreSQL (`users`, `user_preferences`, `user_saved_places`, `user_route_history`).
  4. Thiếu server-side authorization: API không xác thực danh tính người dùng thực.

---

## 4. Kế hoạch triển khai khắc phục P0

- **P0.1: Xây dựng Camera Ingestion Scheduler hoàn chỉnh**
  - Tạo `backend/app/services/camera_scheduler.py`.
  - Thiết kế bảng PostgreSQL `camera_ingestion_state` lưu vết: `camera_id`, `last_attempt_at`, `last_success_at`, `next_retry_at`, `failure_count`, `http_status`, `validation_status`, `image_hash`, `model_status`.
  - Luân phiên thông minh qua 796 camera với Rate Limiting, Exponential Backoff, Circuit Breaker và Redis Lease Lock.
  - Phân loại chuẩn xác: `VALID_FRAME`, `PLACEHOLDER_FRAME`, `CAMERA_OFFLINE`, `SOURCE_RESTRICTED`, `RATE_LIMITED`, `TIMEOUT`.
  - Tách queue tải ảnh khỏi queue suy luận ONNX.
  - Endpoint quản trị `/api/v1/admin/camera-ingestion/status`.
- **P0.2: Tái cấu trúc MapLibre Camera Layer & State**
  - Thống nhất `CameraLayerState` (một nguồn sự thật duy nhất).
  - Khắc phục lỗi zoom $< 10$: MapLibre clustering hiển thị toàn bộ 796 camera ở mọi mức zoom.
  - Xử lý filter `ALL`, `HAS_IMAGE`, `ON_ROUTE` với phản hồi rõ ràng.
  - Tạo debug panel chỉ hoạt động ở môi trường development.
- **P0.3: Triển khai Google OAuth thực sự với PostgreSQL Persistence**
  - Xóa bỏ hoàn toàn `loginDemo()` và thông tin giả "Nguyễn Văn An".
  - Tích hợp NextAuth / Auth.js với Google Provider chuẩn Authorization Code Server-side.
  - Tạo bảng `users`, `user_preferences`, `user_saved_places`, `user_route_history` trong Postgres.
  - Cấu hình trạng thái `BLOCKED_CONFIGURATION` minh bạch khi chưa có Google Client ID/Secret.
- **P0.4: Kiểm thử hồi quy, Chụp ảnh màn hình & Báo cáo hoàn công**
  - Pytest backend + Playwright E2E live.
  - Tạo `docs/P0_CAMERA_AUTH_IMPLEMENTATION_REPORT.md`.

