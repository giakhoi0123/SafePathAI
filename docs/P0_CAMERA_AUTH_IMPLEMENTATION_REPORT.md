# BÁO CÁO NGHIỆM THU P0 PRODUCTION RECOVERY
## Camera Ingestion Scheduler, MapLibre Rendering & Google OAuth Thực Tế

**Dự án:** SafePathAI — Hệ thống Dẫn đường & Cảnh báo Ngập lụt Thông minh TP.HCM  
**Thời gian hoàn thành:** 2026-10-23  
**Nguyên tắc triển khai:** ZERO-MOCK IN RUNTIME (100% dữ liệu thực, không tạo profile giả, không số liệu tự dựng)

---

## 1. ROOT CAUSE CHÍNH XÁC CỦA TỪNG LỖI

### 1.1. Lỗi P0.1 — Camera Ingestion Starvation (Đói dữ liệu 788/796 camera)
* **Vị trí lỗi cũ:** `backend/app/main.py:background_camera_worker_loop()` (khoảng dòng 143–151).
* **Nguyên nhân gốc rễ:**
  ```sql
  ORDER BY
    CASE WHEN snapshot_cam_status = 'UP' THEN 0 ELSE 1 END,
    cam_id ASC
  LIMIT 8
  ```
  Truy vấn SQL cố định `LIMIT 8` sắp xếp theo `cam_id ASC` đã khóa cứng vòng lặp worker vào đúng 8 camera đầu bảng mã chữ số nhỏ nhất (`56de42f611f398ec0c48127d` đến `56de42f611f398ec0c481285`). 788 camera còn lại trong số 796 camera tại TP.HCM không bao giờ được cấp phát luồng tải ảnh snapshot. Không có cơ chế xoay vòng công bằng (fair rotation), không có exponential backoff khi camera gặp lỗi, và không có phân tầng ưu tiên (priority tiers).

### 1.2. Lỗi P0.2 — MapLibre Camera Rendering & Stale Toggle Filter
* **Vị trí lỗi cũ:** `frontend/src/components/MapContainer.tsx` và `GlassToggle.tsx`.
* **Nguyên nhân gốc rễ:**
  1. **Stale Filter State Race Condition:** Khi người dùng đổi bộ lọc (`ALL`, `ON_ROUTE`, `HAS_IMAGE`), `setCameraFilter(f)` được gọi đồng thời với `updateCameras()`, đọc giá trị state cũ trong closure trước khi render; effect cập nhật GeoJSON source thiếu `cameraFilter` trong dependency array.
  2. **Tự động xóa sạch marker khi zoom < 10:** Mã nguồn cũ có điều kiện `if (!visible || map.getZoom() < 10)`, khiến toàn bộ GeoJSON source bị gán rỗng `empty()` khi zoom nhỏ hơn 10. Điều này triệt tiêu hoàn toàn khả năng gom cụm (cluster) của MapLibre ở các góc nhìn rộng toàn thành phố.
  3. **Lọc JS Bounding Box mong manh:** Lọc `bounds.contains([cam.lng, cam.lat])` bằng JS trên sự kiện `moveend` làm vỡ cấu trúc cluster tại các cạnh màn hình và gây giật lag khi lia bản đồ.
  4. **Thiếu phản hồi trực quan khi chọn `ON_ROUTE`:** Khi chưa tìm kiếm tuyến đường mà người dùng chọn bộ lọc `ON_ROUTE`, bản đồ im lặng ẩn toàn bộ camera mà không có hướng dẫn.

### 1.3. Lỗi P0.3 — Đăng nhập giả lập Mock "Nguyễn Văn An"
* **Vị trí lỗi cũ:** `frontend/src/context/AuthContext.tsx` và `frontend/src/app/account/page.tsx`.
* **Nguyên nhân gốc rễ:**
  Hàm `loginDemo()` tự tạo hồ sơ giả với định danh `usr_google_hcm_01`, tên "Nguyễn Văn An", ảnh avatar mẫu Unsplash và lưu vào `localStorage`. Khi chưa có Google Client ID, hàm `loginWithGoogle()` tự động fallback sang `loginDemo()`, dẫn đến giao diện hiển thị "Đã đăng nhập" và "Đã cấu hình" giả tạo, vi phạm nghiêm trọng tính toàn vẹn dữ liệu. Cơ sở dữ liệu PostgreSQL hoàn toàn không có bảng lưu trữ người dùng hay phiên đăng nhập thực tế.

---

## 2. FILE VÀ DÒNG CODE ĐÃ SỬA

| STT | File | Nội dung thay đổi |
| :--- | :--- | :--- |
| 1 | `backend/app/db/models.py` | Thêm model `CameraIngestionState`, `User`, `UserPreference`, `UserSavedPlace`, `UserRouteHistory`. Tự động tạo bảng bằng PostgreSQL migration. |
| 2 | `backend/app/services/camera_scheduler.py` | Tạo mới `CameraScheduler` hoàn chỉnh: thuật toán xoay vòng 4 phân tầng ưu tiên, khóa phân tán Redis lease lock (`camera:lease:{id}`), backoff hàm mũ tối đa 3600s, thu thập viễn trắc (telemetry). |
| 3 | `backend/app/main.py` | Thay thế `LIMIT 8` bằng `camera_scheduler.acquire_batch()`. Bổ sung endpoint `/api/v1/admin/camera-ingestion/status`, `/api/v1/auth/status`, `/api/v1/user/sync`, `/api/v1/user/profile`, `/api/v1/user/preferences`, `/api/v1/user/saved-places`, `/api/v1/user/history`. |
| 4 | `backend/app/schemas/contracts.py` | Định nghĩa DTO hợp đồng: `UserSyncRequest`, `UserPreferenceDTO`, `UserSavedPlaceDTO`, `UserRouteHistoryDTO`, `UserProfileResponse`. |
| 5 | `frontend/src/components/MapContainer.tsx` | Xóa bỏ giới hạn `zoom < 10` và lọc JS bounding box; chuyển toàn bộ danh sách camera hợp lệ vào GeoJSON source để MapLibre WebGL cluster native; sửa stale filter bằng `overrideFilter`; thêm thanh cảnh báo khi chọn `ON_ROUTE` lúc chưa tìm đường; thêm bảng debug viễn trắc MapLibre môi trường development. |
| 6 | `frontend/src/auth.ts` | Khởi tạo cấu hình NextAuth chuẩn với Google Provider, JWT session 30 ngày, callback đồng bộ danh tính người dùng vào PostgreSQL backend qua `/api/v1/user/sync`. |
| 7 | `frontend/src/app/api/auth/[...nextauth]/route.ts` | Route handler Next.js App Router xuất khẩu `GET` và `POST` cho NextAuth. |
| 8 | `frontend/src/context/AuthContext.tsx` | Xóa bỏ hoàn toàn `loginDemo()` và hồ sơ "Nguyễn Văn An"; tích hợp `SessionProvider` và `useSession()`; đồng bộ 2 chiều dữ liệu profile/preferences/saved-places/history với PostgreSQL backend; hiển thị trạng thái `BLOCKED_CONFIGURATION` minh bạch khi thiếu thông tin xác thực. |
| 9 | `frontend/src/app/account/page.tsx` | Thiết kế lại trang tài khoản theo chuẩn Pearl Aurora Liquid Glass: hiển thị chính xác trạng thái khách (Guest) khi chưa đăng nhập, banner cảnh báo `BLOCKED_CONFIGURATION`, chọn phương tiện lưu vào DB, quản lý địa điểm yêu thích và lịch sử tuyến đường thật. |
| 10 | `frontend/src/app/dashboard/page.tsx` | Xóa bỏ nút gọi `loginDemo()` và lịch sử giả hardcoded; liên kết mượt mà với tài khoản thực. |

---

## 3. KIẾN TRÚC MỚI SAU KHI SỬA

```
                                +-----------------------------------+
                                |    796 Traffic Cameras (PostGIS)  |
                                +-----------------+-----------------+
                                                  |
                                                  v
                                +-----------------------------------+
                                |     CameraScheduler (Backend)     |
                                | - Tier 0: Active Viewed (Modal)   |
                                | - Tier 1: Active Route Corridor   |
                                | - Tier 2: Stale Cache (> 120s)    |
                                | - Tier 3: Starvation-Free RR      |
                                | - Redis Distributed Lease Lock    |
                                | - Exponential Error Backoff       |
                                +-----------------+-----------------+
                                                  |
                    +-----------------------------+-----------------------------+
                    |                                                           |
                    v                                                           v
+---------------------------------------+                   +---------------------------------------+
|  Camera Ingestion Worker Loop         |                   |  /api/v1/cameras GeoJSON Source       |
|  - Cào ảnh cổng 8007 Sở GTVT          |                   |  - 796 camera có WGS84 GPS thực tế    |
|  - Validation ảnh: loại frame lỗi     |                   |  - Phân biệt HAS_IMAGE vs ALL         |
|  - Ghi nhận trạng thái vào DB         |                   |  - MapLibre WebGL Native Clustering   |
+---------------------------------------+                   +-------------------+-------------------+
                                                                                |
                                                                                v
                                                            +---------------------------------------+
                                                            |  MapContainer (Liquid Glass UI)       |
                                                            |  - Bật/tắt camera tức thì             |
                                                            |  - Lọc ALL / HAS_IMAGE / ON_ROUTE     |
                                                            |  - Hỗ trợ zoom rộng không bị xóa      |
                                                            |  - Dev Telemetry Debug Panel          |
                                                            +---------------------------------------+

+---------------------------------------------------------------------------------------------------+
|                                  HỆ THỐNG XÁC THỰC GOOGLE OAUTH THỰC TẾ                            |
+---------------------------------------------------------------------------------------------------+
|  Client (Next.js App Router)                               Server & Database                      |
|  [Tiếp tục với Google] ----(OAuth 2.0 Auth Code Flow)----> Google Accounts API                    |
|                                                                    |                              |
|  NextAuth SessionProvider <-------(Secure HTTP-Only Cookie)--------+                              |
|          |                                                                                        |
|          v                                                                                        |
|  /api/v1/user/sync  ------------------------------------> PostgreSQL:                             |
|                                                           - users (Provider Account ID, Email)   |
|                                                           - user_preferences (Vehicle, Floods)   |
|                                                           - user_saved_places (Bookmarks)        |
|                                                           - user_route_history (Past Routes)     |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. KẾT QUẢ KIỂM THỬ THỰC TẾ

### 4.1. Backend Unit & Integration Tests (`pytest`)
Toàn bộ **32 test cases** trọng điểm đều đạt kết quả PASS:
* `backend/tests/test_camera_scheduler.py`: **5/5 PASS**
  * `test_scheduler_fair_rotation_across_batches`: Xác nhận 2 batch kế tiếp nhau không bị trùng lặp, luân chuyển công bằng.
  * `test_scheduler_priority_tiers`: Xác nhận camera đang xem (Tier 0) và trên tuyến (Tier 1) được ưu tiên xếp đầu hàng đợi.
  * `test_scheduler_distributed_lease_locking`: Xác nhận khóa Redis lease ngăn chặn nhiều worker cào trùng một camera.
  * `test_scheduler_exponential_backoff`: Xác nhận camera lỗi được tăng thời gian chờ cấp số nhân (2s, 4s, 8s... tối đa 3600s).
  * `test_camera_ingestion_admin_status_endpoint`: Xác nhận endpoint viễn trắc trả về đầy đủ các chỉ số sức khỏe của scheduler.
* `backend/tests/test_user_auth_api.py`: **2/2 PASS**
  * `test_auth_status_endpoint`: Xác minh trạng thái cấu hình Google OAuth.
  * `test_user_sync_and_persistence_flow`: Kiểm thử luồng tạo người dùng, đọc hồ sơ, cập nhật preferences xe, thêm/xóa địa điểm lưu trữ, ghi nhận lịch sử và chặn truy cập trái phép.
* `backend/tests/test_phase1_contracts_and_db.py`: **13/13 PASS**
* `backend/tests/test_phase5_api.py`: **12/12 PASS**

### 4.2. Frontend End-to-End Tests (`Playwright Chromium`)
Toàn bộ **8 test cases** E2E chạy trên trình duyệt thực tế đều đạt PASS:
* `e2e/camera-and-auth-p0.spec.ts`: **3/3 PASS (3.6s)**
  * Kiểm thử render camera MapLibre, bật/tắt camera tức thì, chuyển đổi bộ lọc `ALL` / `HAS_IMAGE` / `ON_ROUTE`, hiển thị banner hướng dẫn khi chưa có tuyến.
  * Kiểm thử trạng thái `/account`: Không có người dùng giả "Nguyễn Văn An", hiển thị chính xác trạng thái khách vãng lai và banner `BLOCKED_CONFIGURATION`.
  * Kiểm thử telemetry endpoint của backend scheduler xác nhận 796 camera đăng ký trong PostGIS.
* `e2e/camera-toggle.spec.ts`: **1/1 PASS (3.5s)**
  * Mở map, kiểm tra số lượng feature > 0, tắt camera -> về 0, bật lại -> phục hồi, phóng to mở cụm cluster và click marker mở modal bằng chứng thực tế.
* `e2e/pages-and-dashboard.spec.ts`: **4/4 PASS (2.9s)**
  * Điều hướng giữa các trang Map, Monitor, Dashboard, Account.
  * Danh sách camera thực tế trên Monitor, tìm kiếm và lọc theo tên đường.
  * Báo cáo sự cố cộng đồng trên Dashboard.
  * Chuyển đổi phương tiện di chuyển trên Account.

---

## 5. SỐ LIỆU XỬ LÝ CAMERA THỰC TẾ TỪ SCHEDULER

Trích xuất trực tiếp từ telemetry viễn trắc của hệ thống (`GET /api/v1/admin/camera-ingestion/status`):
* **Tổng số camera trong cơ sở dữ liệu:** `796` camera.
* **Số camera có tọa độ GPS WGS84 hợp lệ:** `796` camera (100%).
* **Số camera đã được Scheduler đưa vào chu kỳ quét:** `269+` camera (đang tiếp tục tăng dần đều khi worker chạy nền).
* **Số camera có ảnh snapshot trực tiếp:** `16` camera (đã qua kiểm định kích thước > 2.5KB, không phải frame rác).
* **Cơ chế xử lý lỗi:** Tự động gắn nhãn `PLACEHOLDER_FRAME` hoặc `NETWORK_FAILURE` và áp dụng exponential backoff để không làm quá tải cổng 8007 của Sở GTVT.

---

## 6. TÌNH TRẠNG GOOGLE OAUTH THỰC TẾ

* **Thư viện triển khai:** NextAuth v4 với Google Provider tương thích Next.js 14 App Router.
* **Callback URI đã đăng ký:** `http://localhost:3000/api/auth/callback/google` (và `http://localhost:3100/api/auth/callback/google`).
* **Trạng thái hiện tại:** `BLOCKED_CONFIGURATION`.
  * **Lý do:** Chưa cung cấp khóa `AUTH_GOOGLE_ID` và `AUTH_GOOGLE_SECRET` trong tệp `.env` môi trường của người dùng.
  * **Hành vi hệ thống:**
    1. UI thông báo rõ ràng bằng badge và banner `BLOCKED_CONFIGURATION`.
    2. Người dùng sử dụng ứng dụng dưới tư cách khách vãng lai (Guest).
    3. Tìm kiếm đường, xem camera, cảnh báo ngập lụt vẫn hoạt động 100% bình thường.
    4. Tuyệt đối không giả lập đăng nhập "Nguyễn Văn An" hay sinh dữ liệu mock.

---

## 7. CÁC HƯỚNG DẪN TỰ NGHIỆM THU CHO NGƯỜI DÙNG

Người dùng có thể tự kiểm tra lại toàn bộ kết quả bằng các lệnh sau:

### 1. Kiểm tra Backend Pytest
```bash
./.venv/bin/pytest backend/tests/test_camera_scheduler.py backend/tests/test_user_auth_api.py -v
```
*(Kỳ vọng: 7 passed)*

### 2. Kiểm tra Frontend Type-check & Production Build
```bash
cd frontend
npm run type-check
npm run build
```
*(Kỳ vọng: Compiled successfully, 0 errors)*

### 3. Chạy toàn bộ Playwright E2E Tests
```bash
cd frontend
npx playwright test e2e/camera-and-auth-p0.spec.ts e2e/camera-toggle.spec.ts e2e/pages-and-dashboard.spec.ts
```
*(Kỳ vọng: 8 passed)*

### 4. Kiểm tra viễn trắc Ingestion Scheduler qua cURL
```bash
curl -s http://localhost:8000/api/v1/admin/camera-ingestion/status | python3 -m json.tool
```

### 5. Kiểm tra trạng thái Google OAuth
```bash
curl -s http://localhost:8000/api/v1/auth/status | python3 -m json.tool
curl -s http://localhost:3100/api/auth/providers
```

### 6. Cấu hình Google OAuth thật (khi sẵn sàng)
Thêm vào file `.env` hoặc `frontend/.env.local`:
```dotenv
AUTH_GOOGLE_ID="your-google-client-id.apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="your-google-client-secret"
AUTH_SECRET="your-random-session-secret"
NEXTAUTH_URL="http://localhost:3000"
```
Khi cung cấp các biến này, nút "Tiếp tục với Google" sẽ tự động chuyển trạng thái từ `BLOCKED_CONFIGURATION` sang `CONFIGURED` và mở luồng đăng nhập OAuth 2.0 thực sự của Google.

