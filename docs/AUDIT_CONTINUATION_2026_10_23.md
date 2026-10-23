# BÁO CÁO KIỂM TOÁN VÀ TIẾP NỐI PHÁT TRIỂN SAFEPATHAI (23/10/2026)

Hồ sơ kiểm toán này được lập tại commit `04f7f160a3e5999b3390184cab849e5edec8b4c7` trên repository `giakhoi0123/SafePathAI` làm cơ sở so sánh gốc, tuân thủ nguyên tắc **Zero-Mock in Product** và bảo toàn sự thật kỹ thuật.

---

## 1. Kiểm Toán Trạng Thái Runtime Hệ Thống (HEAD)

- **Commit SHA**: `04f7f160a3e5999b3390184cab849e5edec8b4c7`
- **Git Working Tree**: Sạch sẽ (`git status --short` không có untracked/modified trước khi bắt đầu Phase 1).
- **Trạng thái Container Docker (`docker compose ps`)**:
  - `safepath-osrm`: `osrm/osrm-backend` (port 5001 -> 5000) — **Up 4 hours (healthy)**.
  - `safepath-postgis`: `postgis/postgis:15-3.3` (port 5432) — **Up 16 hours (healthy)**.
  - `safepath-redis`: `redis:7-alpine` (port 6379) — **Up 16 hours (healthy)**.
- **Backend Health API (`/api/v1/health`)**:
  - `status`: `healthy`
  - `database`: `healthy`
  - `redis`: `healthy`
  - `osrm`: `available`
  - `camera_data_age_seconds`: `null` (phản ánh trung thực: chưa có camera stream realtime hợp thức).
- **OSRM Engine Trực tiếp (`:5001`)**:
  - Trả về mã `Ok`, khoảng cách và lộ trình chính xác trên dữ liệu OpenStreetMap Việt Nam (ví dụ: Lê Thánh Tôn, Phan Bội Châu).
- **PostGIS Đồ thị Không gian**:
  - `road_segments`: **343.610** Ways OSM (SRID 4326).
  - `road_edges`: **1.858.355** Cạnh đường hình học (SRID 4326 + GiST geography index).
  - `traffic_cameras`: **796** bản ghi metadata từ VDMS.
- **Redis Cache & Signal**:
  - Đang lưu trữ và cập nhật tự động `env:current_weather_tide` (Open-Meteo mưa thực địa: 0.1-0.2 mm/h; trạm triều Phú An mốc Hòn Dấu VN-2000).
- **Thị giác Máy tính (CV ONNX)**:
  - Model `data/models/yolov5n.onnx` (3.8MB) có mã SHA-256 `04f0e55c26f58d17145b36045780fe1250d5bd2187543e11568e5141d05b3262` khớp hoàn toàn với `data/models/model_manifest.json`.

---

## 2. Ma Trận Vấn Đề Kỹ Thuật & Kế Hoạch Sửa Chữa (Issue Log)

| ID | Module & Vị trí (File:Dòng) | Tác động (Impact) | Nguyên nhân gốc (Root Cause) | Phương thức xác minh | Tiêu chuẩn nghiệm thu (Acceptance) | Tình trạng |
|---|---|---|---|---|---|:---:|
| **ISS-01** | `frontend/src/app/page.tsx:39-46, 330-380` | Người dùng bị giới hạn trong 6 preset cứng, không thể tìm địa chỉ tự do tại TP.HCM. | Dùng mảng tĩnh `HCMC_PRESETS` và thẻ `<select>` thô sơ; chưa có geocoding service. | **Xác minh qua Runtime & Source** | 2 Search Combobox tự do (Origin & Destination) có debounce, gợi ý địa chỉ tiếng Việt thật, hỗ trợ copy/paste `lat,lng`. | **RESOLVED & VERIFIED** (100% tests pass) |
| **ISS-02** | `frontend/src/app/page.tsx:178-181` | Trang tự động tìm đường ngay khi vừa load, lãng phí tài nguyên và làm mất quyền chủ động của người dùng. | `useEffect` rỗng gọi ngay `handleSearchRoute()`. | **Xác minh qua Runtime & Source** | Bỏ auto-route lúc mount; trang bắt đầu ở trạng thái `IDLE`; chỉ route khi đủ 2 điểm hợp lệ và có sự đồng ý của người dùng. | **RESOLVED & VERIFIED** (Zero-Mock compliant) |
| **ISS-03** | `frontend/src/app/page.tsx:184-198` | Click bản đồ chọn điểm dùng cơ chế chẵn/lẻ (`clickCount % 2`), gây nhầm lẫn và khó thao tác. | Cơ chế đếm click toggle tùy tiện không có chỉ báo trực quan. | **Xác minh qua Source** | UX chọn điểm rõ ràng: Nút bật chế độ "Chọn điểm đi" hoặc "Chọn điểm đến", click trên map gán đúng điểm mong muốn. | **RESOLVED & VERIFIED** (Mode-aware banner + click) |
| **ISS-04** | `frontend/src/app/page.tsx`, `MapContainer.tsx` | Thiếu tính năng "Vị trí của tôi", người dùng không thể lấy tọa độ GPS hiện tại. | Chưa tích hợp `navigator.geolocation` và xử lý các trạng thái cấp quyền của trình duyệt. | **Xác minh qua Source** | Nút "Vị trí của tôi" ở ô xuất phát + nút nổi trên bản đồ, xử lý đủ lỗi từ chối quyền/timeout, vẽ vòng accuracy, flyTo zoom 16. | **RESOLVED & VERIFIED** (Live E2E verified) |
| **ISS-05** | `frontend/src/components/MapContainer.tsx:316-338` | Marker A và B thiếu nhãn trợ năng (Accessible Labels) và styling chưa hiện đại. | Khởi tạo div thô sơ với `innerText = "A"` / `"B"`. | **Xác minh qua Source** | Marker dạng Pin/Dot hiện đại, có `aria-label` và `role="img"` rõ ràng, hỗ trợ screen readers. | **RESOLVED & VERIFIED** (Accessible Pins) |
| **ISS-06** | `backend/app/services/scraper.py`, `models.py:75-90` | 796 camera VDMS chưa xác minh được góc nhìn (line-of-sight), không thể chấm điểm ngập chính xác cho đoạn đường. | Thiếu metadata góc quay (pan/tilt/zoom), FOV và góc cao thực tế từ cơ quan quản lý. | **Cần người vận hành cung cấp** (Camera calibration metadata) | Hệ thống gán trạng thái `UNVERIFIED` / `SPATIALLY_NEAR` và trả kết quả `UNKNOWN`, không gán `SAFE` bừa bãi. | **PARTIAL** |
| **ISS-07** | `backend/app/services/vision.py:175-195` | Phân đoạn mặt nước ngập chưa có trọng số Deep Learning thực địa. | Chưa có tập dữ liệu gán nhãn ảnh ngập đường phố TP.HCM có kiểm định độc lập. | **Cần chuyên gia AI / người vận hành** (Dataset & Weights) | Hệ thống trả `MODEL_UNAVAILABLE`, không sinh mask ngập ảo; cảnh báo dựa trên vũ lượng Open-Meteo và trạm triều. | **BLOCKED** |
| **ISS-08** | `backend/app/services/routing.py:465-495`, `k6_route_search.js` | Độ trễ tăng khi chịu tải 30 VUs (p50 ~1.9s, p95 ~3.3s, 2.37% timeout). | Truy vấn `ST_DWithin` trên 343k đường chạy đồng thời trên tiến trình Python đơn luồng. | **Xác minh qua Runtime** (k6 load test) | Khuyến nghị cấu hình 4-8 Uvicorn workers kết hợp Redis spatial corridor caching khi triển khai cụm Production. | **PARTIAL** |

---

## 3. Phân Loại Nguồn Lực & Ranh Giới Kỹ Thuật

1. **Đã xác minh qua Runtime**:
   - OSRM MLD engine trên cổng 5001.
   - PostGIS 343.610 đường và 1.858.355 cạnh đường.
   - Redis đồng bộ tín hiệu thời tiết Open-Meteo và trạm triều Phú An (mốc Hòn Dấu VN-2000).
   - Mô hình ONNX YOLOv5n nhận diện phương tiện.
   - Khả năng chịu tải thực tế (k6 benchmark 30 VUs).
2. **Xác minh qua Source Code**:
   - Luồng chọn điểm trên giao diện người dùng và dropdown presets.
   - Xử lý mã lỗi REST API (503 khi OSRM offline, 400 khi tọa độ ngoài phạm vi, 404 khi thiếu ảnh).
   - WebSocket auto-reconnect với Exponential Backoff.
3. **Cần Người Vận Hành Cung Cấp**:
   - Cấp quyền / API chính thức truy cập stream camera giao thông thời gian thực từ cơ quan chức năng.
   - Dữ liệu hiệu chuẩn góc nhìn camera (Camera calibration / field of view metadata).
   - Bộ trọng số phân đoạn ngập nước đã được kiểm định độc lập.

---

## 4. Báo Cáo Hoàn Thành Phase 1 (Search Tự Do, Geolocation & Navigation UX)

### 4.1. Thay Đổi Kỹ Thuật Đã Triển Khai
1. **Dịch vụ Geocoding Đa Tầng (`backend/app/services/geocoding.py`)**:
   - Tích hợp công cụ tìm kiếm địa danh Photon Komoot API với giới hạn bounding box TP.HCM (`106.3, 10.3, 107.1, 11.2`) và ngôn ngữ `vi`.
   - Cơ chế fallback trực tiếp vào PostGIS `road_segments` qua `ST_Centroid` và khớp tên đường không phân biệt hoa thường khi mạng ngoài gián đoạn.
   - Bộ phân tích biểu thức chính quy (Regex) bắt trực tiếp tọa độ thô `lat, lng` (chuẩn WGS84).
   - Bộ nhớ đệm Redis phân cấp với `TTL = 3600s` cho truy vấn địa điểm và `TTL = 86400s` cho geocoding đảo ngược (reverse).
   - Đăng ký 2 endpoint chuẩn REST: `GET /api/v1/places/search` và `GET /api/v1/places/reverse`.

2. **Giao Diện Combobox Thông Minh (`PlaceSearchCombobox.tsx`)**:
   - Phím gõ tìm kiếm tiếng Việt có debounce (280ms), tự hủy yêu cầu cũ khi nhập ký tự mới (AbortController).
   - Tích hợp danh mục landmark cục bộ tức thời (`LOCAL_LANDMARKS`) cho 0ms độ trễ khi tìm các địa danh lớn (Chợ Bến Thành, Landmark 81, Ngã tư Hàng Xanh, Sân bay TSN, Nhà thờ Đức Bà, Nguyễn Hữu Cảnh).
   - Đạt chuẩn trợ năng WAI-ARIA (`role="combobox"`, `role="listbox"`, `role="option"`, `aria-expanded`, phím điều hướng `Enter`/`Escape`).

3. **Định Vị GPS "Vị Trí Của Tôi" & Điều Hướng Trạng Thái**:
   - Tích hợp HTML5 Geolocation API (`navigator.geolocation.getCurrentPosition`) tại ô xuất phát và nút nổi bản đồ.
   - Xử lý 3 trạng thái từ chối quyền (PERMISSION_DENIED), mất tín hiệu (POSITION_UNAVAILABLE) và timeout (TIMEOUT) kèm thông báo tiếng Việt không gây treo trang.
   - FlyTo animation mượt mà (zoom 16) và vẽ vòng tròn bán kính sai số (accuracy circle) kết hợp tâm định vị màu xanh lam.
   - Loại bỏ hoàn toàn cơ chế auto-routing khi vừa mở trang (Zero-Mock in Product). Bổ sung máy trạng thái UX: `IDLE`, `SEARCHING_PLACE`, `LOCATION_REQUESTING`, `READY_TO_ROUTE`, `ROUTING`, `ROUTE_FOUND`, `NO_ROUTE`, `PROVIDER_DOWN`.
   - Thay thế cơ chế đếm số lần click chuột chẵn/lẻ bằng chế độ chọn điểm rõ ràng (`MapSelectionMode`: `ORIGIN`, `DESTINATION`, `NONE`) với banner chỉ báo trực quan trên bản đồ.

### 4.2. Kết Quả Kiểm Thử Toàn Diện (Zero-Mock Verification)
- **Backend Test Suite (Pytest)**:
  - Lệnh: `OSRM_LIVE_TESTS=1 OSM_ROAD_LIVE_TESTS=1 .venv/bin/pytest backend/tests/ -v`
  - Kết quả: **112 passed, 5 skipped (0 failures) trong 17.02s**.
- **Frontend Live E2E (Playwright với OSRM & PostGIS thật)**:
  - Lệnh: `cd frontend && npx playwright test`
  - Kết quả: **9 passed, 1 skipped (0 failures) trong 40.8s**.
    - `phase1-places-search-live.spec.ts`: 6/6 tests PASS (tìm 3 địa chỉ ngoài preset, parse tọa độ trực tiếp, chặn query <3 ký tự, vô hiệu hóa nút tìm khi xóa điểm, stub cấp quyền GPS thành công & từ chối quyền).
    - `safepath.spec.ts`: 2/2 tests PASS (tuyến đường OSRM thật trên nền vector tiles, 5 cặp tọa độ độc lập tải lộ trình thật).
    - `road-segment-live.spec.ts`: 1/1 test PASS (highlight đoạn OSRM mà không gán giả OSM Way ID).
- **Next.js Production Build**:
  - Lệnh: `cd frontend && npm run build`
  - Kết quả: **Biên dịch thành công (exit 0)**, 0 lỗi TypeScript, 0 lỗi cú pháp Webpack.

---

## 5. Báo Cáo Hoàn Thành Phase 2 (P0 — Camera: Hiển Thị Ảnh Thực và Trạng Thái Trung Thực)

Tuân thủ nguyên tắc **Zero-Mock in Product**, Phase 2 tái cấu trúc toàn diện cơ chế tiếp nhận, xác thực và hiển thị ảnh camera giao thông, xóa bỏ hoàn toàn các cờ chặn thô bạo, các badge mô hình giả lập và việc tự động suy diễn trạng thái an toàn khi chưa có bằng chứng xác minh.

### 5.1. Các Thay Đổi Kiến Trúc Kỹ Thuật Đã Triển Khai

1. **Phân Tách Rạch Ròi Giữa Quyền Xem Ảnh và Điều Kiện Làm Bằng Chứng Định Tuyến**:
   - `ImageAccessStatus`: `VIEWABLE_PUBLIC` (cho phép xem trực tiếp), `VIEWABLE_AUTHORIZED` (nguồn ủy quyền), `EXTERNAL_ACCESS_RESTRICTED` (bị giới hạn truy cập từ ngoài), `UNAVAILABLE` (ảnh không khả dụng).
   - `EvidenceEligibility`: `ROUTING_ELIGIBLE` (chỉ khi có bản quyền, timestamp xác thực, góc nhìn LOS và mô hình kiểm định), `NOT_VERIFIED_FOR_ROUTING` (chỉ hiển thị xem tham khảo, không được can thiệp vào thuật toán tính rủi ro tuyến đường).
   - `Line-of-Sight (LOS) Safety Gate`: Bất kỳ camera nào chưa được kiểm định góc nhìn/hướng quay thì `risk_level` bắt buộc phải là `RiskLevel.UNKNOWN`, không bao giờ được tự động hạ rủi ro của đoạn đường xuống `SAFE`.

2. **Cấu Hình Phân Quyền Chi Tiết (`backend/app/core/config.py`)**:
   - Thay thế cờ chặn đơn `CAMERA_INGESTION_PERMITTED=False` bằng các biến phân quyền tường minh:
     - `CAMERA_ALLOW_VIEW_ONLY = True` (cho phép người dùng xem ảnh tĩnh hợp lệ trong cache).
     - `CAMERA_ROUTING_EVIDENCE_PERMITTED = False` (nghiêm cấm dùng ảnh chưa kiểm chứng để đổi trọng số định tuyến).
     - `CAMERA_IMAGE_TTL_SECONDS = 180` (thời gian sống của ảnh cache).
     - `CAMERA_DISK_EVICTION_MAX_HOURS = 24` (tự động dọn dẹp ảnh cũ trên ổ đĩa).

3. **Cải Tiến Endpoint Ảnh (`GET /api/v1/cameras/{id}/image`)**:
   - Kiểm tra bảo mật chống tấn công duyệt thư mục (Path Traversal Protection) với regex `^[0-9a-fA-F]{24}$` hoặc safe slug; trả về HTTP 400 nếu phát hiện ký tự bất thường (`../`, `/etc/`).
   - Hỗ trợ đầy đủ HTTP Headers: `Content-Type: image/jpeg`, `Content-Length`, `Cache-Control: public, max-age=180`, `ETag`, `X-Source-Timestamp`.
   - Hỗ trợ HTTP 304 Not Modified khi client gửi `If-None-Match` khớp với ETag.
   - Trả về HTTP 404 với mã lỗi `IMAGE_UNAVAILABLE` hoặc `PERMISSION_UNVERIFIED` khi không có ảnh/hết hạn, tuyệt đối không trả ảnh 1x1 giả mạo hoặc ảnh tĩnh placeholder đánh lừa người dùng.

4. **Endpoint Metadata Chuyên Biệt (`GET /api/v1/cameras/{id}/metadata`)**:
   - Cung cấp lý do kỹ thuật chi tiết (`VALID_IMAGE_CACHED`, `IMAGE_UNAVAILABLE`, `CAPTURE_TIME_UNKNOWN`, `PERMISSION_UNVERIFIED`, `PLACEHOLDER_FRAME`, `EXTERNAL_ACCESS_RESTRICTED`).
   - Cung cấp `source_uri`, `captured_at`, `retrieved_at`, `file_size_bytes` cho phép giao diện người dùng hiển thị thông tin minh bạch.

5. **Hợp Đồng Dữ Liệu "Null Is Not Zero" (Python & TypeScript)**:
   - Các trường phân tích: `vehicle_count: Optional[int] = None`, `flood_ratio: Optional[float] = None`, `traffic_density_score: Optional[float] = None`.
   - Giao diện `CameraEvidenceModal.tsx`:
     - Nếu chỉ số là `null`: Hiển thị "Chưa kiểm định (N/A)" kèm badge `UNKNOWN`. Tuyệt đối không hiển thị "0 xe / Mật độ 0.00 / Ngập 0.0% / SAFE" gây hiểu nhầm đường thông thoáng khi camera chưa phân tích.
     - Xóa bỏ hoàn toàn badge cứng "ONNX YOLOv8x" khi frame chưa chạy suy luận thực tế. Chỉ hiển thị badge AI khi có `model_version`, `inference_time_ms` và `model_status == VERIFIED`.
     - Hiển thị đầy đủ nhãn trạng thái truy cập (`VIEWABLE_PUBLIC` vs `EXTERNAL_ACCESS_RESTRICTED`) và trạng thái bằng chứng (`ROUTING_ELIGIBLE` vs `NOT_VERIFIED_FOR_ROUTING`).
     - Tích hợp nút "Mở tại nguồn gốc" và nút "Thử tải lại" tiện lợi.

6. **Tối Ưu Hóa Worker Nền (`backend/app/services/scraper.py`)**:
   - Bỏ giới hạn cứng `LIMIT 20` ngẫu nhiên; ưu tiên các camera có trạng thái `UP` trong registry cơ sở dữ liệu.
   - Tích hợp Circuit Breaker tự ngắt khi gặp mã lỗi 429/403 liên tiếp để bảo vệ máy chủ nguồn.
   - Phát hiện và loại bỏ ảnh placeholder (khung hình 306x236 PNG "IMAGE NOT AVAILABLE" với MD5 `5f5b2bf141af555a87e3f1d6c3ab3017`).
   - Cơ chế tự động dọn dẹp các tệp ảnh cache trên đĩa (`evict_stale_disk_images`) vượt quá thời gian lưu trữ tối đa.
   - Bắt buộc kiểm tra chứng chỉ bảo mật TLS (`verify=True`) trong client HTTP.

### 5.2. Kết Quả Kiểm Thử Toàn Diện (Zero-Mock Verification)

1. **Backend Integration & Unit Tests (Pytest)**:
   - File test mới: `backend/tests/test_camera_metadata_and_snapshot_live.py` (10/10 test cases PASS).
   - Toàn bộ backend suite:
     - Lệnh: `OSRM_LIVE_TESTS=1 OSM_ROAD_LIVE_TESTS=1 .venv/bin/pytest backend/tests/ -v`
     - Kết quả: **116 passed, 5 skipped (0 failures) trong 16.97s**.
   - Các trường hợp kiểm thử quan trọng:
     - `test_parse_vdms_snapshot_exact_796_nodes`: Khớp chính xác 796 camera trong snapshot.
     - `test_postgis_camera_registry_trust_gate`: Camera thiếu LOS gán `UNKNOWN` và `NOT_VERIFIED_FOR_ROUTING`.
     - `test_image_validation_multi_stage`: Phát hiện chính xác khung hình rỗng / placeholder MD5.
     - `test_get_camera_image_endpoint_zero_mock`: Chặn ảnh giả mạo, phục vụ ảnh cache với ETag.
     - `test_path_traversal_protection`: Chặn đứng các chuỗi tấn công `../../../etc/passwd` với HTTP 400.
     - `test_null_is_not_zero_in_camera_list`: Phản ánh đúng giá trị `None` cho camera chưa suy luận.
     - `test_etag_and_caching_and_headers`: Phản hồi đúng HTTP 304 khi ETag trùng khớp.

2. **Frontend End-to-End Live Tests (Playwright)**:
   - Lệnh: `cd frontend && npx playwright test`
   - Kết quả: **9 passed, 1 skipped (0 failures) trong 44.0s**.
   - Xác minh toàn bộ luồng:
     - `osrm-down.spec.ts`: Bỏ qua an toàn khi OSRM đang hoạt động bình thường.
     - `phase1-places-search-live.spec.ts`: 6/6 tests PASS (tìm kiếm địa danh, tọa độ thô, định vị HTML5).
     - `safepath.spec.ts`: 2/2 tests PASS (lộ trình OSRM thật trên vector map, 5 cặp địa danh độc lập tại TP.HCM).
     - `road-segment-live.spec.ts`: 1/1 test PASS (highlight đoạn đường an toàn không giả mạo OSM Way ID).

3. **Frontend Production Build**:
   - Lệnh: `cd frontend && npm run build`
   - Kết quả: **Biên dịch thành công (exit 0)**, 0 lỗi TypeScript, kích thước tối ưu (First Load JS 316 kB).

---

## 6. Báo Cáo Hoàn Thành Phase 3 (Route Results, Responsive Bottom Sheet & Step Highlights)

### 6.1. Kiến Trúc & Cải Tiến Giao Diện Người Dùng
1. **Module Tuyến Đường Đa Ứng Viên (`RouteResults.tsx`)**:
   - Phân loại rõ ràng các tuyến: `Nhanh nhất`, `Ít rủi ro đã ghi nhận`, `Đường khác`.
   - Bảng tổng hợp mức rủi ro trung thực: nếu toàn bộ các đoạn đều chưa có dữ liệu quan trắc thì hiển thị "Rủi ro chưa xác minh", không gán nhãn "An toàn" tùy tiện.
   - Trình bày trực quan thời gian OSRM (phút), khoảng cách (km), danh sách đoạn cần lưu ý.
2. **Chi Tiết Từng Bước Dẫn Đường (Step Maneuvers & Camera Links)**:
   - Danh sách bước rẽ có thể gập/mở (collapsible) theo chuẩn trợ năng WAI-ARIA (`aria-expanded`, `aria-pressed`).
   - Nhấp vào từng bước để highlight hình học đoạn đường tương ứng trên bản đồ vector qua `data-highlight-vertices`.
   - Nút liên kết xem trực tiếp camera giám sát dọc theo từng bước dẫn đường.
3. **Thiết Kế Thích Ứng Di Động (Responsive Bottom Sheet)**:
   - Trên màn hình nhỏ (Mobile/Tablet), aside chuyển thành Bottom Sheet có thể kéo/mở linh hoạt (`min(37dvh, 280px)`).
   - Bảo đảm bản đồ luôn nhìn thấy và không che khuất nhãn bản quyền bắt buộc của OpenStreetMap và OpenFreeMap.

### 6.2. Tổng Hợp Tình Trạng Các Nhiệm Vụ (Status Summary)

#### A. ĐÃ GIẢI QUYẾT TRIỆT ĐỂ (RESOLVED & VERIFIED)
1. **Zero-Mock Routing & Real OSM Geometry**: Toàn bộ tuyến đường định tuyến 100% qua OSRM backend trên dữ liệu OpenStreetMap Việt Nam thực.
2. **Free Search Geocoding & HTML5 Location**: Tìm kiếm tự do mọi địa chỉ TP.HCM qua Photon API + PostGIS fallback + Regex bắt tọa độ trực tiếp WGS84.
3. **Camera Truthful Access & Metadata**: Phân tách rõ `image_access_status` (quyền xem) và `evidence_eligibility` (điều kiện làm bằng chứng định tuyến). Bảo vệ chống Path Traversal trên mã camera. Trả mã HTTP 404/400 có lý do kỹ thuật thay vì fallback âm thầm. Hỗ trợ ETag và HTTP 304.
4. **Data Contract "Null Is Not Zero"**: Không gán mặc định `vehicle_count = 0` hay `flood_ratio = 0.0%` khi chưa chạy AI thực. Giao diện hiển thị minh bạch "Chưa kiểm định (N/A)".
5. **Worker Nền Có Kiểm Soát**: Bỏ giới hạn cứng LIMIT 20, ưu tiên camera 'UP', có Circuit Breaker chống spam server nguồn, dọn dẹp cache đĩa tự động, lọc bỏ ảnh placeholder 306x236.
6. **Mobile Responsive Bottom Sheet & Step Highlights**: Bố cục tương thích di động, kiểm thử E2E tự động xác nhận không tràn viền ngang và không che nhãn bản quyền OSM.

#### B. CHƯA GIẢI QUYẾT / RANH GIỚI KỸ THUẬT (PENDING / TECHNICAL BOUNDARIES)
1. **ISS-06 (LOS/FOV Camera)**: 796 camera VDMS chưa có siêu dữ liệu góc nhìn (Line-of-Sight) chính thức từ cơ quan quản lý.
   - *Biện pháp an toàn hiện tại*: Hệ thống gán cố định `RiskLevel.UNKNOWN` và `NOT_VERIFIED_FOR_ROUTING`, cấm hạ rủi ro tuyến đường khi chưa đủ bằng chứng.
2. **ISS-07 (Trọng số Deep Learning Phân Đoạn Ngập Nước)**: Chưa có bộ trọng số AI phân đoạn ngập nước đô thị TP.HCM được huấn luyện và kiểm định độc lập.
   - *Biện pháp an toàn hiện tại*: Hệ thống trả `MODEL_UNAVAILABLE`, từ chối sinh mask ngập giả mạo. Cảnh báo rủi ro dựa trên vũ lượng Open-Meteo và trạm triều Phú An.
3. **ISS-08 (Khả năng chịu tải đồng thời ST_DWithin)**: Khi chịu tải 30 người dùng đồng thời, p95 đạt ~3.3s.
   - *Khuyến nghị khi lên Production*: Triển khai cụm Uvicorn đa tiến trình (4-8 workers) kết hợp Redis spatial corridor caching cho các lộ trình phổ biến.

---

## 7. Bằng Chứng Kiểm Thử Tổng Thể Toàn Hệ Thống

```
================================================================================
                           KẾT QUẢ KIỂM THỬ TỔNG HỢP
================================================================================
1. Backend Unit & Integration Tests (Pytest):
   - Lệnh: OSRM_LIVE_TESTS=1 OSM_ROAD_LIVE_TESTS=1 .venv/bin/pytest backend/tests/ -q
   - Kết quả: 116 passed, 5 skipped (0 failures) trong 19.65s [100% PASS]

2. Frontend Live E2E Tests (Playwright):
   - Lệnh: cd frontend && npx playwright test
   - Kết quả: 13 passed, 1 skipped (0 failures) trong 1.2m [100% PASS]
     + osrm-down.spec.ts: 1 skipped (kịch bản mô phỏng sự cố OSRM)
     + phase1-places-search-live.spec.ts: 6/6 passed (tìm kiếm, tọa độ, GPS HTML5)
     + phase3-route-results-live.spec.ts: 4/4 passed (chọn tuyến OSRM, bottom sheet, 404/503 retry)
     + road-segment-live.spec.ts: 1/1 passed (highlight đoạn đường an toàn)
     + safepath.spec.ts: 2/2 passed (lộ trình OSRM thật trên vector tiles, 5 cặp tọa độ độc lập)

3. Next.js Production Build:
   - Lệnh: cd frontend && npm run build
   - Kết quả: Compiled successfully (exit 0), 0 lỗi TypeScript, 0 lỗi cú pháp Webpack
================================================================================
```

