# SAFEPATHAI 3.0 — BÁO CÁO KIỂM TOÁN HIỆN TRẠNG (PRE-CHECK AUDIT)

**Thời điểm kiểm toán:** `2026-10-24 02:05:32 +07:00`  
**Mục tiêu:** Rà soát toàn bộ frontend, backend, auth, database, routing, thị giác máy tính và giao diện trước khi triển khai tái cấu trúc SafePathAI 3.0.

---

## 1. BẢNG TRẠNG THÁI HIỆN TRẠNG CÁC PHÂN HỆ

| Phân hệ / Yêu cầu | Trạng thái | Đánh giá hiện trạng & Nguyên nhân gốc |
| :--- | :---: | :--- |
| **Auth Page: Thẻ kỹ thuật OAuth** | ❌ **BROKEN** | Trang `/account` vẫn chứa hoặc có nguy cơ hiển thị thẻ "Trạng thái xác thực Google OAuth 2.0" kèm các trường kỹ thuật. Cần loại bỏ hoàn toàn khỏi giao diện người dùng thường. |
| **Auth Page: Nền trắng khi cuộn cuối** | ❌ **BROKEN** | Khi cuộn xuống chân trang `/account`, phần nền gradient dừng đột ngột để lộ khoảng trắng lớn do `min-h-screen` chỉ tính 100vh viewport thay vì toàn bộ document height. |
| **Auth Security: Hardcoded Fallback Secret** | ❌ **BROKEN** | File `frontend/src/auth.ts` có chuỗi fallback dự phòng `safepath-jwt-secret-signing-key-...`. Cần xóa bỏ triệt để, bắt buộc lấy từ biến môi trường. |
| **Map Style: Bản đồ tối / đơn sắc** | ❌ **BROKEN** | Style bản đồ mặc định đang dùng Carto Dark Matter / CARTO tối khó đọc tên đường. Cần chuyển sang style sáng đường phố (Google Maps style: nền kem, đường vàng/trắng, công viên xanh lá, sông xanh nước). |
| **Map UI: Mục "Quan trắc nước"** | ❌ **BROKEN** | Dock điều hướng dưới đáy bản đồ có nút "Quan trắc nước" nhưng thiếu dữ liệu trực quan thực tế, gây trải nghiệm rời rạc. Cần gỡ bỏ khỏi dock điều hướng. |
| **Map UI: Độ tương phản nhãn "Chưa có tuyến"** | ❌ **BROKEN** | Nhãn "Chưa có tuyến" cạnh Voice Guidance có chữ trắng mờ trên nền sáng, không đạt chuẩn tương phản WCAG AA. Cần thay badge xám xanh chữ xanh than đậm. |
| **Pearl Aurora Liquid Glass Design** | ⚠️ **PARTIAL** | Hệ thống màu và hiệu ứng kính mờ (Liquid Glass) đã có nhưng tỷ trọng nền tối còn cao, chưa toát lên vẻ sáng (Bright, Ethereal, Premium, Futuristic). |
| **Landing 3D Scroll Experience** | ⚠️ **PARTIAL** | Trang chủ `/` đã có scene scroll nhưng tỷ trọng nền tối còn nhiều, chưa tối ưu 3D view cho điểm giao cắt và thiếu liên kết ảnh camera thực tế. |
| **Thời tiết theo vị trí (Weather by Location)** | ⚠️ **PARTIAL** | Backend có hàm nhưng chưa có endpoint REST chuẩn `GET /api/v1/weather/location?lat=...&lng=...`; frontend chỉ dùng 1 tọa độ trung tâm cho mọi camera/tuyến. |
| **Thủy triều thực tế (Real Tide Signals)** | ⚠️ **PARTIAL** | Dữ liệu thủy triều hiện tại phụ thuộc Redis cache tĩnh, chưa có crawler tự động hoặc chưa công bố rõ trạng thái `OBSERVATION_UNAVAILABLE`. |
| **Tin giao thông thay ô đo nước** | ❌ **BROKEN** | Chưa có pipeline cào và gắn tọa độ tin giao thông (Traffic News) để thay thế các ô đo nước chưa có model kiểm định trong Camera Modal và Route Details. |
| **YOLO Bỏ sót phương tiện giao thông** | ❌ **BROKEN** | Khung hình camera ngã tư có xe nhưng YOLOv5n chỉ phát hiện rải rác hoặc 0 detection do độ phân giải đầu vào, ngưỡng NMS/confidence và tiền xử lý chưa tối ưu. |
| **Thuật ngữ kỹ thuật trong User UI** | ❌ **BROKEN** | Giao diện còn xuất hiện các từ ngữ kỹ thuật: "OSRM", "ONNX", "YOLOv5n", "COCO", "STALE", "BLOCKED_CONFIGURATION". Cần Việt hóa thân thiện cho người dùng phổ thông. |

---

## 2. BẰNG CHỨNG HÌNH ẢNH TRƯỚC THAY ĐỔI (PRE-CHANGE SCREENSHOTS)

Các ảnh chụp màn hình hiện trạng đã được ghi nhận tại `docs/`:
- `docs/pre_v3_landing.png`: Trang chủ trước tái thiết kế.
- `docs/pre_v3_map.png`: Bản đồ tối Carto Dark Matter với các đường phố khó nhận diện.
- `docs/pre_v3_account.png`: Trang tài khoản với các thông số cài đặt.
- `docs/pre_v3_account_bottom.png`: Lỗi khoảng trắng ở chân trang khi cuộn xuống cuối `/account`.
- `docs/pre_v3_dashboard.png`: Bảng điều khiển còn nhiều khoảng trống.
- `docs/pre_v3_monitor.png`: Danh sách camera giám sát.

---

## 3. LỘ TRÌNH THỰC THI CHI TIẾT (ACTION PLAN)

1. **PHASE 1:** Dọn dẹp Auth Page, xóa hardcoded secret trong `auth.ts`, sửa lỗi nền trắng cuộn chân trang và tăng cường bảo mật session.
2. **PHASE 2:** Chuyển MapLibre sang Style bản đồ đường phố SÁNG (Bright Street Map), loại bỏ "Quan trắc nước" khỏi dock, sửa tương phản nhãn "Chưa có tuyến".
3. **PHASE 5 - 7:** Mở rộng API thời tiết theo tọa độ (`/api/v1/weather/location`), chuẩn hóa nguồn thủy triều trạm Phú An/Nhà Bè, xây dựng pipeline Tin giao thông gắn tọa độ (Traffic News Nearby).
4. **PHASE 8:** Tối ưu pipeline Computer Vision (xử lý ảnh đầu vào, NMS, confidence, tiled inference) để khắc phục lỗi bỏ sót xe.
5. **PHASE 3 - 4:** Thiết kế hệ thống Pearl Aurora Liquid Glass (bản đồ sáng, bảng điều khiển nổi, card trong suốt sang trọng) và Landing Page 3D scroll.
6. **PHASE 9 - 10:** Xây dựng Dashboard đa năng (My Journeys, Traffic Around Me, City Pulse, Community Reports), loại bỏ toàn bộ thuật ngữ kỹ thuật khỏi UI.
7. **PHASE 11:** Chạy test suite, kiểm thử E2E Playwright trên trình duyệt thật, chụp ảnh nghiệm thu và lập báo cáo hoàn thành.

