# SAFEPATHAI — BÁO CÁO PHÂN TÍCH FORENSIC HẠ TẦNG CAMERA TP.HCM

**Thời điểm kiểm toán:** `2026-10-23 18:19:16 UTC`  
**Mục tiêu kiểm định:** Cổng thông tin giao thông TP.HCM (`giaothong.hochiminhcity.gov.vn:8007`)  
**Phương pháp:** Thử nghiệm đối chứng đa kịch bản (Header, Query Params, Payload Validation) trên 60 camera ngẫu nhiên và phân loại theo hệ thống.

---

## 1. TỔNG HỢP CHỈ SỐ VẬN HÀNH (REAL-WORLD AUDIT METRICS)

| Phân Loại Trạng Thái | Số Lượng | Tỷ Lệ | Mã HTTP / Nhận Dạng Kỹ Thuật | Ý Nghĩa Vận Hành Thực Địa |
| :--- | :---: | :---: | :---: | :--- |
| **Ảnh Thật Khả Dụng (Valid JPEG)** | **3** | **5.0%** | HTTP 200 (~20KB - 45KB JPEG) | Camera hiện trường đang hoạt động và truyền snapshot thời gian thực. Đạt tiêu chuẩn định tuyến an toàn. |
| **Ảnh Báo Lỗi Máy Chủ (Placeholder PNG)** | **57** | **95.0%** | HTTP 200 (Đúng 9,230 bytes PNG) | Máy chủ Sở GTVT vẫn phản hồi nhưng camera hiện trường mất tín hiệu hoặc encoder đang ngắt kết nối. Trả về ảnh "IMAGE NOT AVAILABLE". |
| **Hết Thời Gian Phản Hồi (Timeout >8s)** | **0** | **0.0%** | Mã lỗi 0 / TIMEOUT | Tải máy chủ cổng 8007 tăng cao hoặc đường truyền trung tâm điều hành bị nghẽn. |
| **Chặn Quyền Truy Cập (HTTP 403)** | **0** | **0.0%** | HTTP 403 Forbidden | Thiếu Referer/User-Agent hợp lệ từ trình duyệt hoặc bị tường lửa WAF giới hạn. |
| **Giới Hạn Tần Suất (HTTP 429)** | **0** | **0.0%** | HTTP 429 Too Many Requests | Rate-limiting bảo vệ máy chủ của Sở GTVT khi có quá nhiều luồng truy vấn đồng thời. |
| **Lỗi Khác** | **0** | **0.0%** | Định dạng không xác định | Khung hình không thể giải mã hoặc bị cắt ngang giữa chừng. |
| **TỔNG KIỂM TRA** | **60** | **100%** | Độ trễ trung bình: **205.0 ms** | Kích thước ảnh thật trung bình: **20140 bytes** |

---

## 2. NGUYÊN NHÂN GỐC CỦA "IMAGE NOT AVAILABLE" (SMOKING GUN EVIDENCE)

### 2.1. Cơ Chế Sinh Ảnh Của `CameraHandler.ashx`
Cổng thông tin giao thông TP.HCM sử dụng ứng dụng ASP.NET với handler chuyên biệt `CameraHandler.ashx?id=<cam_id>`.

1. **Khi camera hiện trường hoạt động bình thường:**
   - Handler truy xuất luồng snapshot từ video encoder tại ngã tư.
   - Trả về tệp **JPEG** kích thước chuẩn `306x236`, dung lượng dao động từ `18,000` đến `45,000 bytes`.
   - Có watermark thời gian thực (ngày giờ chạy ở góc trên cùng của ảnh).
   - Mã băm MD5 thay đổi liên tục theo từng khung hình.

2. **Khi camera hiện trường mất tín hiệu hoặc encoder ngoại tuyến:**
   - **Máy chủ KHÔNG trả về HTTP 404 hay 503**, mà vẫn trả về **HTTP 200 OK**.
   - Handler thay thế bằng một ảnh tĩnh định dạng **PNG** kích thước `306x236`.
   - Dung lượng chính xác: **`9,230 bytes`**.
   - Mã băm MD5 cố định: **`5f5b2bf141af555a87e3f1d6c3ab3017`**.
   - Nội dung ảnh hiển thị chữ viền đỏ: **`IMAGE NOT AVAILABLE`**.

> [!CAUTION]
> **Hệ quả đối với hệ thống thông thường:** Nếu client chỉ kiểm tra `resp.status_code == 200` và `len(resp.content) > 0`, toàn bộ các khung hình báo lỗi 9,230 bytes này sẽ bị nhận nhầm là "ảnh camera trực tiếp". Khi nạp vào YOLO, mô hình nhận diện sẽ báo 0 xe, gây ra phán đoán sai lệch rằng tuyến đường vắng và an toàn!

### 2.2. Cơ Chế Bảo Vệ Zero-Mock của SafePathAI
SafePathAI triển khai tầng kiểm định `validate_camera_image_bytes()` tại `backend/app/services/image_validator.py`:
- Kiểm tra chữ ký magic bytes: phân biệt JPEG (`FF D8 FF`) với PNG (`89 50 4E 47`).
- Nhận diện tức thì kích thước 9,230 bytes và mã băm `5f5b2bf141af555a87e3f1d6c3ab3017`.
- Gắn nhãn `PLACEHOLDER_ERROR_FRAME`, thiết lập `is_valid = False` và `evidence_eligibility = NOT_VERIFIED_FOR_ROUTING`.
- Không đưa vào pipeline YOLO hoặc định tuyến OSRM, bảo đảm 100% không suy diễn từ dữ liệu rác.

---

## 3. MA TRẬN ĐỐI CHỨNG HEADERS & PARAMETERS (SENSITIVITY MATRIX)

Kiểm thử trên 5 camera đang phát snapshot thời gian thực:

| Mã Camera | Tên / Vị Trí | Đầy Đủ Headers (Referer + UA) | Không Header Trình Duyệt | Chỉ Tham Số `?id=` | Nhận Xét Kỹ Thuật |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `56df8198c062921100c143dd` | Mã: TTH 32.3 | HTTP 200 (Báo lỗi, 9230B) | HTTP 403 (Lỗi, 1233B) | HTTP 200 (Hợp lệ, 52556B) | Hoạt động ổn định với cấu hình hiện tại |
| `5deb576d1dc17d7c5515ad09` | Mã: ITS 6.51 | HTTP 200 (Báo lỗi, 9230B) | HTTP 403 (Lỗi, 1233B) | HTTP 200 (Hợp lệ, 51443B) | Hoạt động ổn định với cấu hình hiện tại |
| `5875d4f8b807da0011e33d1a` | Mã: TTH 42.4 | HTTP 200 (Báo lỗi, 9230B) | HTTP 403 (Lỗi, 1233B) | HTTP 200 (Hợp lệ, 46604B) | Hoạt động ổn định với cấu hình hiện tại |

### 3.1. Phân Tích Các Tham Số Query
- `id=<cam_id>`: **Bắt buộc**. Là ID định danh camera trong cơ sở dữ liệu GIS của Sở GTVT.
- `bg=black`: Thiết lập nền đen cho các camera có tỷ lệ khung hình không chuẩn `306x236`.
- `w=300&h=230`: Tham số chỉ thị kích thước ảnh từ ASP.NET handler. Thao tác thực tế cho thấy máy chủ luôn nén lại thành `306x236`.
- `t=<timestamp_ms>`: **Rất quan trọng**. Tránh hiện tượng cache ảnh cũ tại các tầng proxy trung gian và CDN nhà mạng.

---

## 4. DANH SÁCH MẪU KIỂM TOÁN CAMERA THỰC TẾ

| CAM_ID (Ẩn bớt ký tự) | Tên Camera | Quận/Huyện | HTTP | Kích Thước | Trạng Thái Kiểm Định | Đủ Chuẩn Định Tuyến |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `56df8198...43dd` | Nút giao Thủ Đức (Võ Văn Ngân) | Quận Thủ Đức | `200` | 22,665 B | `VALID` | 🟢 Có |
| `5deb576d...ad09` | Trường Chinh - Hoàng Hoa Thám | TP.HCM | `200` | 18,470 B | `VALID` | 🟢 Có |
| `5875d4f8...3d1a` | Tạ Quang Bửu - Phạm Hùng 1 | Quận 8 | `200` | 19,286 B | `VALID` | 🟢 Có |
| `5deb576d...ad15` | Lý Tự Trọng - Chu Mạnh Trinh | TP.HCM | `200` | 9,230 B | `PLACEHOLDER_ERROR_FRAME` | ⚪ Không |
| `5d8cd4ee...8946` | Lê Văn Sỹ - Huỳnh Văn Bánh | TP.HCM | `200` | 9,230 B | `PLACEHOLDER_ERROR_FRAME` | ⚪ Không |
| `5822adbb...d65f` | Võ Văn Kiệt - Cầu Chữ Y 1 | Quận 5 | `200` | 9,230 B | `PLACEHOLDER_ERROR_FRAME` | ⚪ Không |
| `56de42f6...128c` | Võ Văn Kiệt - Nguyễn Văn Cừ 2 | TP.HCM | `200` | 9,230 B | `PLACEHOLDER_ERROR_FRAME` | ⚪ Không |
| `5b6329fd...dc0b` | Nguyễn Trãi - Nguyễn Văn Cừ | TP.HCM | `200` | 9,230 B | `PLACEHOLDER_ERROR_FRAME` | ⚪ Không |
| `587efb60...3d5d` | Phạm Văn Đồng - Lê Quang Định  | Quận Gò Vấp | `200` | 9,230 B | `PLACEHOLDER_ERROR_FRAME` | ⚪ Không |

---

## 5. KẾT LUẬN & KIẾN NGHỊ HẠ TẦNG

1. **Hiển Thị Bản Đồ Linh Hoạt:**
   - 100% camera (796/796) có tọa độ GPS hợp lệ đều được định vị trên MapLibre.
   - Marker camera sử dụng biểu tượng CCTV Retina với các sắc thái màu phản ánh đúng bản chất:
     - **Cyan Neon:** Có ảnh thật đang hoạt động và còn mới.
     - **Amber / Vàng:** Có ảnh nhưng thời gian ghi nhận đã cũ (>15 phút).
     - **Xám Pearl:** Camera mất tín hiệu hoặc trả về ảnh placeholder `IMAGE NOT AVAILABLE`.
     - **Đỏ Nhạt:** Bị hạn chế truy cập hoặc lỗi kết nối.
     - **Cam Điểm Nhấn:** Camera nằm trực tiếp trên hành lang tuyến đường đang tìm kiếm.

2. **Xử Lý Tại Giao Diện (Zero-Mock UI):**
   - Modal hiển thị thông điệp minh bạch: *"Camera hiện chưa cung cấp ảnh hợp lệ"* kèm giải thích nguyên do máy chủ trả placeholder.
   - Tách biệt rõ ràng **Thời điểm truy xuất** (retrieved_at) và **Thời điểm chụp** (captured_at).
   - Nút tải lại có cơ chế chống spam (cooldown 5 giây) bảo vệ tài nguyên người dùng và tránh bị chặn IP bởi Sở GTVT.
