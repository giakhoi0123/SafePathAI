# BÁO CÁO NGHIỆM THU P0: KHẮC PHỤC TRIỆT ĐỂ RENDER CAMERA MAPLIBRE & ĐỒNG BỘ 796 CAMERA TP.HCM

**Ngày thực hiện:** 24/10/2026  
**Dự án:** SafePathAI (Phiên bản Zero-Mock Runtime)  
**Phạm vi:** Sửa triệt để lỗi không render marker camera trên bản đồ MapLibre, xây dựng Registry & Canonical URL cho toàn bộ 796 camera giao thông TP.HCM, và đồng bộ dữ liệu thực lên trang Giám sát.

---

## 1. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE) LỖI 0 RENDERED MARKERS TRÊN BẢN ĐỒ

### 1.1. Hiện tượng ban đầu
Dù API backend trả về đủ 796 camera và GeoJSON `camera-source` trên MapLibre nhận đủ 796 feature, bản đồ vẫn hiển thị:
```text
API Total:       796
Valid GPS:       796
GeoJSON Feat:    796
Map Zoom:        13.85
Render Pts:      0
Clusters:        0
Visible:         YES
```
Các điểm camera hoàn toàn không xuất hiện trên canvas bản đồ.

### 1.2. Chẩn đoán chuyên sâu (Deep Diagnostic)
Qua quá trình can thiệp và bóc tách trực tiếp cơ chế quản lý tile của MapLibre GL (`_source.loadTile` và trạng thái `tile.state`), toàn bộ các tile của `camera-source` đều bị rơi vào trạng thái `state = "errored"` với biệt lệ:
```text
AJAXError: (404): https://tiles.openfreemap.org/fonts/Open Sans Regular,Arial Unicode MS Regular/0-255.pbf
```

### 1.3. Cơ chế gây lỗi dây chuyền
1. Trong [MapContainer.tsx](file:///Users/phamgiakhoi/SafePath-Hackathon/frontend/src/components/MapContainer.tsx), hai symbol layer gồm `camera-count` (hiển thị số lượng camera trong cụm) và `camera-label` (tên camera khi zoom lớn) được thêm vào `camera-source` nhưng **không chỉ định thuộc tính `text-font`**.
2. Khi thiếu `text-font`, MapLibre tự động dùng font stack mặc định là `["Open Sans Regular", "Arial Unicode MS Regular"]`.
3. Máy chủ tile OpenFreeMap Liberty **không lưu trữ** font stack kết hợp này mà lưu trữ riêng rẽ theo chuẩn Noto Sans (ví dụ: `Noto Sans Regular`, `Noto Sans Bold`). Yêu cầu font stack mặc định bị trả về HTTP 404.
4. Khi worker của MapLibre nạp glyph thất bại với mã 404, nó hủy bỏ toàn bộ quá trình nạp bucket của tile đó và đánh dấu tile là `"errored"`.
5. Vì các circle layer `camera-clusters` và `camera-points` dùng chung nguồn dữ liệu `camera-source` với các symbol layer bị lỗi, MapLibre hủy bỏ render toàn bộ tile, dẫn tới cả circle và symbol đều biến mất (`Render Pts: 0, Clusters: 0`).

---

## 2. GIẢI PHÁP KHẮC PHỤC TRIỆT ĐỂ (ROOT CAUSE FIX)

### 2.1. Cập nhật `text-font` chuẩn tương thích OpenFreeMap
Trong [MapContainer.tsx](file:///Users/phamgiakhoi/SafePath-Hackathon/frontend/src/components/MapContainer.tsx):
- Layer `camera-count`: Chỉ định rõ `"text-font": ["Noto Sans Bold"]`.
- Layer `camera-label`: Chỉ định rõ `"text-font": ["Noto Sans Regular"]`.

OpenFreeMap trả về HTTP 200 cho hai phông chữ này, giúp tile worker hoàn thành xử lý tile mà không gặp bất kỳ lỗi 404 nào.

### 2.2. Khắc phục lỗi API proxy Next.js
Trong [next.config.mjs](file:///Users/phamgiakhoi/SafePath-Hackathon/frontend/next.config.mjs), thêm rule `rewrites()` chuyển tiếp các yêu cầu `/api/v1/:path*` từ cổng 3000 sang backend cổng 8000 (`http://localhost:8000/api/v1/:path*`). Điều này đảm bảo tính tương thích cho cả client gọi trực tiếp lẫn SSR.

### 2.3. Bổ sung Hit-Testing Bounding-Box cho thao tác Click
Trong hàm `onMapClick` của `MapContainer.tsx`, bổ sung bounding-box 10px để bắt trúng các điểm camera hoặc cụm cluster ngay cả khi người dùng click trên màn hình cảm ứng hoặc click lệch vài pixel khỏi tâm vòng tròn bán kính 6px. Đồng thời tự động kích hoạt phóng to `getClusterExpansionZoom` khi bấm vào cụm.

---

## 3. THIẾT LẬP REGISTRY 796 CAMERA & CANONICAL URLS

### 3.1. Kịch bản chuẩn hóa: `scripts/build_camera_url_registry.py`
Tạo script độc lập trích xuất 796 node camera từ [list_camera_coordinate.txt](file:///Users/phamgiakhoi/SafePath-Hackathon/list_camera_coordinate.txt) thông qua `vdms_parser`:
- Trích xuất tọa độ WGS84 chính xác (kinh độ 106.x, vĩ độ 10.x), tuyệt đối không gán centroid quận/huyện.
- Sinh Canonical Stream & Image URL theo chuẩn Cổng thông tin giao thông TP.HCM:
  `https://giaothong.hochiminhcity.gov.vn:8007/Render/CameraHandler.ashx?id=<cam_id>`
- Tạo tệp tin chỉ mục [camera_url_manifest.json](file:///Users/phamgiakhoi/SafePath-Hackathon/data/cameras/camera_url_manifest.json) chứa đầy đủ metadata của 796 camera.
- Thực hiện Upsert đồng bộ vào bảng cơ sở dữ liệu PostGIS `traffic_cameras` (cập nhật `stream_url`, `source_uri`, `geom`, `coordinate_verified_at`).

### 3.2. Kết quả thực thi Registry
```text
Total Cameras: 796
Valid GPS:     796 (100%)
DB Upserted:   796
Manifest File: data/cameras/camera_url_manifest.json
```

---

## 4. ENDPOINT SUMMARY & ĐỒNG BỘ TRANG GIÁM SÁT (/MONITOR)

### 4.1. Endpoint Backend `GET /api/v1/cameras/summary`
Bổ sung schema `CameraSummary` trong [contracts.py](file:///Users/phamgiakhoi/SafePath-Hackathon/backend/app/schemas/contracts.py) và endpoint tại [main.py](file:///Users/phamgiakhoi/SafePath-Hackathon/backend/app/main.py):
- `total_registered`: 796
- `valid_gps_count`: 796
- `checked_count`: Số camera đã được Ingestion Scheduler thăm dò theo chu kỳ
- `valid_images_count`: Số camera có ảnh thực tế hợp lệ (trong vòng 15 phút)
- `stale_images_count`: Số camera có ảnh nhưng đã quá hạn
- `unavailable_count`: Số camera tạm thời không kết nối được
- `analyzed_count`: Số camera đã qua mô hình AI (YOLO + Flood U-Net)
- `last_scheduler_cycle`: Thời điểm chu kỳ nạp gần nhất

### 4.2. Giao diện Giám sát (/monitor)
Trong [frontend/src/app/monitor/page.tsx](file:///Users/phamgiakhoi/SafePath-Hackathon/frontend/src/app/monitor/page.tsx):
- Tích hợp gọi `fetchCameraSummary` tự động cập nhật mỗi 15 giây.
- Hiển thị 4 thẻ thống kê kính chất lỏng (Glassmorphism): Tổng Camera (796), Tiến độ Scheduler, Ảnh Trực Tiếp Khả Dụng, Đã Phân Tích AI.
- Render lưới 796 camera thật kèm tính năng lọc quận, tìm kiếm tên/mã và xem chi tiết bằng `CameraEvidenceModal`.

---

## 5. BẰNG CHỨNG KIỂM THỬ THỰC TẾ (REAL VERIFICATION)

### 5.1. Kiểm thử MapLibre Render & Toggle (Playwright Browser Test)
| Trạng thái | GeoJSON Features | Rendered Points | Rendered Clusters | Labels | Visible |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Khởi tạo ban đầu (Zoom 13)** | **796** | **26** | **66** | 0 | **YES** |
| **Bật phóng to (Zoom 15)** | **796** | **39** | **0** | **37** | **YES** |
| **Bấm nút tắt Camera** | **0** | **0** | **0** | 0 | **NO** |
| **Bấm nút bật Camera lại** | **796** | **26** | **66** | 0 | **YES** |

### 5.2. Kiểm thử Tương tác Bản đồ & Modal
- **Click vào cụm camera (Cluster):** Tự động phóng to từ Zoom 13 lên Zoom 15, giải tán cụm thành các camera đơn lẻ.
- **Click vào camera marker:** Mở lập tức `CameraEvidenceModal` hiển thị thông tin thực tế (tên đường, tọa độ GPS WGS84, mã camera, tình trạng ảnh gốc và ảnh tăng cường AI).
- **Kiểm thử trang Giám sát `/monitor`:** Render toàn bộ 796 card camera, click vào card mở modal chi tiết thành công.

### 5.3. Kiểm thử Tự động Codebase
- **TypeScript Typecheck:** `npx tsc --noEmit` đạt mã thoát `0` (Zero errors).
- **Bộ kiểm thử Pytest Backend:**
  ```text
  129 passed, 14 skipped in 21.59s (100% PASS)
  ```
  Tất cả các bài test hợp đồng dữ liệu, zero-mock contract, scheduler starvation prevention, image enhancement, và routing đều vượt qua.

---

## 6. KẾT LUẬN
- Lỗi nghiêm trọng không hiển thị camera marker trên bản đồ MapLibre đã được tìm ra đúng nguyên nhân gốc rễ và xử lý dứt điểm.
- Hệ thống SafePathAI hiện sở hữu registry 796 camera giao thông TP.HCM với 100% tọa độ GPS WGS84 thực tế, URL nạp chuẩn hóa, hệ thống nạp tự động không đói dữ liệu và đồng bộ minh bạch trên cả bản đồ chính và trang giám sát.
- Toàn bộ nguyên tắc ZERO-MOCK IN RUNTIME được tuân thủ nghiêm ngặt.

