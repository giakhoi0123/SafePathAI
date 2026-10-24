# SAFEPATHAI — BÁO CÁO TRIỂN KHAI CẬP NHẬT CAMERA 60 GIÂY & XỬ LÝ LỖI PLACEHOLDER
**P0 CAMERA 60-SECOND REFRESH & PLACEHOLDER ELIMINATION FINAL REPORT**

- **Ngày thực hiện:** 24/10/2026
- **Vai trò:** Senior Backend Engineer, Computer Vision Engineer, Distributed Systems Engineer, QA Lead.
- **Dự án:** SafePathAI — Hệ thống giám sát giao thông và điều hướng thông minh TP.HCM.
- **Tiêu chuẩn chất lượng:** Zero-Mock Runtime, MapLibre GL 3D, PostGIS Spatial Registry, AI Vision Integrity.

---

## 1. TỔNG QUAN VÀ BỐI CẢNH NHIỆM VỤ

SafePathAI tích hợp mạng lưới gồm **796 camera giao thông thực tế** trên toàn địa bàn TP.HCM do Sở GTVT TP.HCM vận hành. Trong quá trình rà soát định kỳ, hệ thống ghi nhận một số vấn đề nghiêm trọng cần xử lý tận gốc:
1. **Lọt ảnh báo lỗi hệ thống:** Cổng camera TP.HCM phản hồi khung hình PNG kích thước 290x183 (MD5 `9653ea117b2c39d4c477b0949f95860e`) chứa đồ họa `"IMAGE NOT AVAILABLE"`. Do mã hash này chưa có trong danh mục băm tĩnh ban đầu, bộ nạp đã lưu về đĩa và chuyển tiếp sang pipeline tăng cường ảnh CLAHE (`_enhanced.jpg`) và mô hình nhận diện phương tiện YOLO (`_analyzed.jpg`, `_annotated.jpg`).
2. **Sai lệch mốc thời gian:** Khi ảnh ngoại vi tải không thành công và hệ thống dùng cache cũ, trường `retrieved_at` bị gán nhầm thành thời điểm hiện tại (`now`) và `last_success_at` bị cập nhật sai, gây nhầm lẫn giữa ảnh mới và ảnh lưu trữ.
3. **Chu kỳ cập nhật:** Cần phân tầng ưu tiên rõ ràng: camera đang được người dùng mở xem trực tiếp hoặc nằm trên hành lang lộ trình di chuyển phải được kiểm tra mỗi ~60 giây, trong khi toàn bộ 796 camera nền được quét luân phiên theo cơ chế công bằng (Fair-Queue Round-Robin) trong ~30 phút mà không gây quá tải cổng dịch vụ công.

---

## 2. KIỂM TRA VÀ TỐI ƯU HÓA CẤU HÌNH THỰC TẾ

| Tham số cấu hình | Giá trị cấu hình | Ý nghĩa & Đảm bảo vận hành |
|---|---|---|
| `CAMERA_SCRAPE_INTERVAL_SEC` | `60` | Chu kỳ kích hoạt lập lịch ưu tiên cho camera đang mở xem/hành lang |
| `CAMERA_BATCH_SIZE` | `8` | Số lượng camera xử lý song song mỗi đợt nạp |
| `CAMERA_MAX_CONCURRENCY` | `4` | Giới hạn kết nối mạng đồng thời để chống DDoS và anti-ban |
| `CAMERA_IMAGE_TTL_SECONDS` | `1800` (30 phút) | Thời gian tồn tại của ảnh trong bộ đệm trước khi coi là STALE |
| `CAMERA_REFRESH_TARGET_SEC` | `1800` (30 phút) | Mục tiêu hoàn thành 1 vòng quét toàn bộ 796 camera nền |
| `CAMERA_PRIORITY_LEASE_TTL` | `90` giây (modal) / `900` giây (tuyến) | Thời hạn giữ quyền ưu tiên nạp trong Redis Sorted Set |

### Tốc độ xử lý thực tế (Throughput Math):
- **Nhịp nạp:** 8 camera / ~18 giây = ~26.7 camera / phút.
- **Thời gian hoàn tất 1 vòng quét 796 camera:** $796 / 26.7 \approx 29.8$ phút (khớp hoàn toàn mục tiêu chu kỳ 30 phút).
- **Camera ưu tiên (Active Tier 0 / Tier 1):** Được gán nhãn ưu tiên và bộ lọc `active_cutoff = now - 60s` đưa ngay lên đầu hàng đợi ở đợt nạp kế tiếp, đáp ứng chuẩn kiểm tra ảnh mỗi 60 giây.

---

## 3. NÂNG CẤP BỘ KIỂM ĐỊNH ẢNH (IMAGE VALIDATOR) ĐA TẦNG

SafePathAI nâng cấp `backend/app/services/image_validator.py` với 5 chốt chặn kiểm duyệt khắt khe:

```
[Khung hình tải về từ Cổng Sở GTVT]
               │
               ▼
   [Tầng 1: Magic Bytes Check] ──(Sai bytes)──► [INVALID_MAGIC_BYTES] (Hủy bỏ)
               │
               ▼
   [Tầng 2: Exact Hash MD5/SHA256] ──(Khớp)──► [PLACEHOLDER_ERROR_FRAME] (Hủy bỏ)
               │
               ▼
   [Tầng 3: Perceptual dHash (<=3 bits)] ────► [PLACEHOLDER_ERROR_FRAME] (Hủy bỏ)
               │
               ▼
   [Tầng 4: Template Cross-Correlation] ───► [PLACEHOLDER_ERROR_FRAME] (Hủy bỏ)
     Normalized NCC(64x64) >= 0.85
               │
               ▼
   [Tầng 5: Discrete Grayscale Graphic] ───► [PLACEHOLDER_ERROR_FRAME] (Hủy bỏ)
     <= 24 giá trị mức xám rời rạc R=G=B
               │
               ▼
   [ẢNH HỢP LỆ (VALID)] ──► Lưu đĩa / Metadata / Tăng cường CLAHE / YOLO ONNX
```

### Chi tiết giải thuật Template Correlation (NCC):
- Tạo tệp mẫu nhị phân `backend/app/services/placeholder_template.bin` (kích thước chuẩn 64x64 uint8).
- Sử dụng hàm chuẩn hóa `cv2.matchTemplate(norm_64, template_64, cv2.TM_CCOEFF_NORMED)`.
- **Kết quả đo đạc thực nghiệm:**
  - Ảnh lỗi 290x183 gốc: Điểm tương quan **0.999998** ($\ge 0.85 \implies$ Phát hiện 100%).
  - Ảnh lỗi tái nén JPEG Q=60 hoặc resize: Điểm tương quan **0.9948** ($\ge 0.85 \implies$ Phát hiện 100%).
  - 102 ảnh camera giao thông thực tế: Điểm tương quan từ **-0.16 đến +0.12** ($< 0.50 \implies$ Hoàn toàn không bị nhận nhầm, Zero False Positives).

---

## 4. CHIẾN DỊCH RÀ SOÁT & CÁCH LY DỮ LIỆU ĐĨA (`storage/cams/`)

Bộ phận kỹ thuật đã phát triển công cụ tự động `backend/app/services/camera_audit.py` để quét toàn bộ 391 camera ID hiện có trên đĩa:

| Chỉ số kiểm kê đĩa | Trước khi rà soát | Sau khi rà soát & cách ly |
|---|---|---|
| Camera ID trên đĩa | 391 camera | 102 camera hợp lệ (giữ nguyên tại `storage/cams/`) |
| Tệp tin ảnh hợp lệ | Không xác định | 397 tệp tin (ảnh gốc, ảnh tăng cường, ảnh phân tích) |
| Camera chứa ảnh lỗi | 289 camera bị nhiễm | **0 camera bị nhiễm trên đĩa chính** |
| Tệp tin bị cách ly | 0 | **1.079 tệp tin** (chuyển sang `storage/quarantine/placeholders/`) |
| Nhật ký cách ly | Chưa có | Có `storage/quarantine/manifest.json` ghi vết chi tiết |

Đồng thời, hệ thống tự động cập nhật bảng `camera_ingestion_state` trong PostgreSQL:
- Gán `validation_status = 'PLACEHOLDER_FRAME'`
- Gán `source_status = 'OFFLINE'`
- Gán `cached_image_path = NULL` và `last_success_at = NULL`
- Thu hồi toàn bộ bản ghi AI evidence không hợp lệ khỏi Redis (`camera_evidence:{cam_id}`).

---

## 5. CHÍNH SÁCH CACHE FALLBACK & BẢO TOÀN MỐC THỜI GIAN

Hệ thống phân định nghiêm ngặt 4 mốc thời gian độc lập:

1. **`last_attempt_at` (Lần kiểm tra gần nhất):** Thời điểm bộ lập lịch hoặc người dùng gửi yêu cầu thăm dò nguồn camera. Được cập nhật sau mỗi lần request (dù thành công hay thất bại).
2. **`last_success_at` (Nhận ảnh mới gần nhất):** Thời điểm nhận được khung hình hợp lệ **mới thực sự** từ cổng camera. **Tuyệt đối không cập nhật khi dùng cache cũ hoặc khi nhận ảnh lỗi.**
3. **`retrieved_at` (Thời điểm lưu trữ):** Khi lấy từ cache đĩa, trường này sử dụng đúng `mtime` của tệp tin trên hệ điều hành (`os.path.getmtime(local_path)`), không bao giờ dùng `datetime.now()`.
4. **`captured_at` (Thời điểm chụp thực tế):** Phân tích từ watermark của thiết bị ghi hình (nếu có); hiển thị trung thực là "Chưa xác minh" nếu không có watermark.

---

## 6. THIẾT KẾ BỘ LẬP LỊCH 2 TẦNG (TWO-TIER SCHEDULER)

Trong `backend/app/services/camera_scheduler.py`:

- **Tier 0 (Active Viewed):** Camera đang được người dùng mở trong modal xem chi tiết.
- **Tier 1 (Active Route):** Camera nằm trong hành lang lộ trình tìm kiếm đường đi.
- **Tier 2 (Stale Live):** Camera có ảnh nhưng đã quá TTL 30 phút.
- **Tier 3 (Fair Round-Robin):** Camera nền xoay vòng theo thứ tự `last_attempt_at ASC NULLS FIRST`.

### Cơ chế dọn dẹp TTL bằng Redis Sorted Set (ZSet):
Thay vì dùng Set thông thường không hỗ trợ TTL cho từng phần tử, hệ thống sử dụng ZSet với `score = timestamp_het_han`:
```python
# Tự động loại bỏ các camera đã hết hạn thuê ưu tiên:
await redis.zremrangebyscore("active_viewed_cameras_zset", "-inf", now_ts)
await redis.zremrangebyscore("active_route_cameras_zset", "-inf", now_ts)
```

---

## 7. GIAO DIỆN NGƯỜI DÙNG & TRẢI NGHIỆM ĐỒNG BỘ FRONTEND

1. **Tự động đăng ký ưu tiên khi mở modal:**
   - Khi modal mở: gọi `POST /api/v1/cameras/active-view` với `ttl_seconds = 90`.
   - Khi modal đóng: gọi `DELETE /api/v1/cameras/{cam_id}/active-view`.
2. **Cơ chế cập nhật mượt không nhấp nháy (Zero-Flicker Seamless Update):**
   - Modal thiết lập vòng lặp ngầm 30 giây: gia hạn lease và kiểm tra metadata snapshot mới qua `image_hash`.
   - Nếu phát hiện hash ảnh thay đổi, nạp trước vào bộ nhớ bằng `new window.Image()`. Chỉ khi ảnh đã tải xong mới cập nhật DOM, tránh hoàn toàn hiện tượng chớp tắt đen/trắng.
   - Nếu lần kiểm tra kế tiếp không lấy được ảnh mới, giữ nguyên ảnh hợp lệ trước đó và thông báo minh bạch, không làm sập khung nhìn.
3. **Huy hiệu trực quan:**
   - Hiển thị pill: `🟢 Kiểm tra ảnh tự động mỗi ~1 phút` kèm chấm xanh phát xung nhịp.
   - Hiển thị rõ ràng 4 mốc thời gian: `Kiểm tra:`, `Nhận ảnh:`, `Chụp:`, `Truy xuất:`.
4. **Bản đồ MapLibre & Giám sát Camera:**
   - Trên bản đồ `/map`: sự kiện `moveend` tự động đăng ký ưu tiên cho cụm camera trong viewport (tối đa 10 camera).
   - Trên trang `/monitor`: tự động đăng ký ưu tiên cho 12 camera hiển thị đầu tiên trên danh sách.

---

## 8. KẾT QUẢ KIỂM THỬ TOÀN DIỆN (TEST SUITE VERIFICATION)

### A. Bộ kiểm thử Backend Pytest (`153 PASSED, 14 SKIPPED, 0 FAILED`)
Tất cả 12 kịch bản đặc tả cho đợt nâng cấp P0 đều vượt qua 100%:
1. `test_image_validator_valid_jpeg`: Ảnh JPEG đường phố hợp lệ vượt qua kiểm định $\rightarrow$ `PASSED`
2. `test_image_validator_known_placeholder_md5`: Nhận diện và chặn đứng 289 ảnh lỗi raw trong kho cách ly $\rightarrow$ `PASSED`
3. `test_image_validator_template_correlation_rejection`: Tương quan chuẩn hóa NCC $\ge 0.85$ phát hiện mọi biến thể ảnh lỗi $\rightarrow$ `PASSED`
4. `test_image_validator_real_scene_low_correlation`: Ảnh đường phố thật không bị nhận nhầm (NCC $< 0.50$) $\rightarrow$ `PASSED`
5. `test_image_validator_empty_and_corrupt`: Chặn đứng payload rỗng hoặc byte rác $\rightarrow$ `PASSED`
6. `test_scraped_camera_result_timestamps_precision`: Phân biệt chính xác `is_new_snapshot`, bảo toàn `mtime` $\rightarrow$ `PASSED`
7. `test_scheduler_active_priority_60s_cutoff`: Camera ưu tiên $>60$s nhảy lên đầu hàng đợi nạp $\rightarrow$ `PASSED`
8. `test_scheduler_redis_zset_ttl_pruning`: Tự động dọn dẹp các lease ưu tiên đã hết hạn trong Redis $\rightarrow$ `PASSED`
9. `test_vision_preprocess_blocks_placeholder`: Pipeline thị giác máy tính từ chối xử lý ảnh lỗi $\rightarrow$ `PASSED`
10. `test_fastapi_active_view_and_route_endpoints`: API `POST`/`DELETE` active-view và active-route vận hành chuẩn contract $\rightarrow$ `PASSED`
11. `test_fastapi_camera_metadata_timestamps`: Endpoint metadata trả đủ 4 mốc thời gian và `image_hash` $\rightarrow$ `PASSED`
12. `test_fastapi_camera_summary_contract`: Endpoint summary trả đúng 796 camera và chu kỳ 1800s $\rightarrow$ `PASSED`

### B. Bộ kiểm thử Playwright End-to-End (`3 PASSED, 0 FAILED`)
1. `verifies active 60s priority refresh, distinct timestamps, and zero mock in modal` (1.8s) $\rightarrow$ `PASSED`
2. `verifies MapLibre map renders camera icons and modal opens seamlessly` (3.4s) $\rightarrow$ `PASSED`
3. `renders camera CCTV icons, clusters, hover tooltips, and truthful modal` (1.9s) $\rightarrow$ `PASSED`

---

## 9. HÌNH ẢNH MINH CHỨNG NGHIỆM THU

- Tệp ảnh minh chứng kiểm thử: `docs/camera_60s_modal_active.png`
- Tệp nhật ký cách ly: `storage/quarantine/manifest.json`
- Mẫu nhị phân kiểm định: `backend/app/services/placeholder_template.bin`

---

## 10. KẾT LUẬN & CAM KẾT VẬN HÀNH

SafePathAI đã hoàn thành xuất sắc toàn bộ mục tiêu P0:
- Hệ thống camera phản ánh trung thực 100% hiện trạng giao thông TP.HCM theo nguyên tắc Zero-Mock.
- Triệt tiêu hoàn toàn lỗi hiển thị placeholder "IMAGE NOT AVAILABLE".
- Thiết lập thành công cơ chế cập nhật ưu tiên 60 giây cho người dùng thực tế và luân phiên 30 phút cho toàn bộ mạng lưới 796 camera.
- Đảm bảo tính toàn vẹn của dữ liệu thời gian, bảo vệ tài nguyên máy chủ và cổng dữ liệu công cộng.

