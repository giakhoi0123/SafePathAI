# SAFEPATHAI — BÁO CÁO KỸ THUẬT: CẢI TỔ TOÀN DIỆN UX ONBOARDING TOUR (P1)
**Hệ thống hướng dẫn từng bước Apple Liquid Glass & Tinh chỉnh luồng Bản tin Giao thông**

---

## 1. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS) CỦA LỖI UI/UX CŨ

Qua audit chi tiết hệ thống guided tour trước khi sửa đổi, chúng tôi đã phát hiện 3 nguyên nhân cốt lõi dẫn đến trải nghiệm onboarding bị nhòe và khó sử dụng:

1. **Lớp Backdrop Filter toàn màn hình (`backdrop-filter: blur(4px)`)**:
   - Ở phiên bản trước, `.driver-overlay` (lớp phủ SVG/DOM của Driver.js) được gán thuộc tính `backdrop-filter: blur(4px)`.
   - Vì lớp overlay này chiếm 100% viewport (`fixed inset-0`), trình duyệt áp dụng bộ lọc mờ Gauss lên toàn bộ canvas và DOM bên dưới. Điều này khiến toàn bộ bản đồ, thẻ bài viết, tiêu đề và số liệu xung quanh bị nhòe mờ, gây nhức mắt và khó đọc cho người dùng.

2. **Target Step 4 bị gán vào container bao quá rộng (`> 800px`)**:
   - Bước 4 của trang `/news` trước đây trỏ vào `[data-tour="news-latest"]` (cột danh sách tin tức chứa toàn bộ các bài viết).
   - Khi spotlight một khối hộp có chiều rộng > 800px và chiều cao hàng nghìn pixel, vùng sáng bị kéo dãn khổng lồ, che lấp các thành phần khác, khiến người dùng không biết cần bấm vào đâu và mất định hướng thao tác.

3. **Popover thiếu tính nhất quán với ngôn ngữ thiết kế Pearl Aurora Liquid Glass**:
   - Popover mặc định thiếu các nút điều khiển trực quan (như nút "Bỏ qua" cố định trong footer), màu sắc chưa đạt chuẩn tương phản WCAG AA, và chưa có cơ chế tự động căn giữa cuộn trang mượt mà (`scrollIntoView({ behavior: 'smooth', block: 'center' })`) khi spotlight các nút bấm nhỏ ở cuối viewport.

---

## 2. GIẢI PHÁP KIẾN TRÚC & TRIỂN KHAI MÃ NGUỒN

### 2.1. Loại bỏ hoàn toàn Blur toàn trang & Chuẩn hóa Lớp phủ Soft Navy (`onboarding.css`)
- **Tập tin:** `frontend/src/styles/onboarding.css`
- **Backdrop:** Thiết lập nền bán trong suốt `rgba(15, 23, 42, 0.28)`, loại bỏ triệt để mọi thuộc tính làm nhòe:
  ```css
  .driver-overlay {
    background: rgba(15, 23, 42, 0.28) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    filter: none !important;
    z-index: 99998 !important;
  }
  ```
- **Active Element & Frame:** Phần tử được spotlight nhận đường viền indigo siêu nét 2px cùng hào quang kép pearl:
  ```css
  .driver-stage {
    border-radius: 14px !important;
    outline: 2px solid rgba(99, 102, 241, 0.75) !important;
    box-shadow: 0 0 0 5px rgba(99, 102, 241, 0.10), 0 10px 35px rgba(79, 70, 229, 0.14) !important;
  }
  .driver-active-element {
    filter: none !important;
    backdrop-filter: none !important;
    z-index: 99999 !important;
  }
  ```

### 2.2. Tinh chỉnh Hộp thoại Popover Phong cách Apple Liquid Glass
- Hộp thoại được tạo từ vật liệu kính trắng ngọc trai 94% mờ nhẹ nội bộ (`rgba(255, 255, 255, 0.94)`), bán kính bo góc 20px, viền kính siêu mỏng `1px solid rgba(255, 255, 255, 0.85)` cùng bóng đổ `box-shadow: 0 18px 50px rgba(30, 41, 59, 0.16)`.
- **Nội dung:** Tiêu đề mực đậm Slate 950 font-bold, mô tả mực trung tính Slate 700 dễ đọc.
- **Footer:** Nút "Bỏ qua" được chèn tự động vào góc trái footer, kết hợp cùng nút "← Quay lại" và "Tiếp tục →" / "Hoàn tất ✓" có hiệu ứng hover phản hồi ánh sáng ngọc trai.

### 2.3. Thu gọn Spotlight Step 4 trên `/news` về đúng Nút Bookmark
- **Tập tin:** `frontend/src/lib/onboarding/tourSteps.ts`, `frontend/src/app/news/page.tsx`
- **Target selector:** Đổi từ `[data-tour="news-latest"]` sang `[data-tour="news-bookmark-action"]`.
- **Kích thước thực tế:** Hộp bounding box của nút Bookmark ~36×36px (hoặc stage ~48×48px), hoàn toàn nằm dưới ngưỡng kiểm soát 120px thay vì 800px+.
- **Văn bản hiển thị:**
  - **Tiêu đề:** *"Lưu tin tức quan trọng"*
  - **Mô tả:** *"Bấm biểu tượng dấu trang bên cạnh bài viết để lưu tin bạn quan tâm. Bạn có thể xem lại các bài đã lưu bất cứ lúc nào trong Bản tin."*
  - **Vị trí Popover:** `side: "top"`, `align: "center"`.

### 2.4. Đảm bảo Tính Ổn định Dữ liệu & Trạng thái Tải (Zero-Glitch Skeleton)
- Trong `frontend/src/app/news/page.tsx`, hệ thống bổ sung skeleton loading đồng bộ cho khối Highlight và khối danh sách bài viết. Nhờ đó, cả 4 phần tử đích của onboarding tour (`news-hero`, `news-highlights`, `news-filters`, `news-bookmark-action`) luôn tồn tại sẵn sàng trong DOM ngay cả khi API mạng đang phản hồi.
- Trong `OnboardingTour.tsx`, cơ chế hủy tour được tách bạch: khi người dùng bấm "Bỏ qua", trạng thái `safepath_tour_state_v1` được lưu chuẩn xác là `status: "skipped"` và không bị ghi đè thành `completed`.

---

## 3. DANH SÁCH TẬP TIN ĐÃ ĐƯỢC CHỈNH SỬA

| Tập tin | Loại thay đổi | Mô tả chi tiết |
|---|---|---|
| `frontend/src/styles/onboarding.css` | Tối ưu CSS | Bỏ toàn bộ `backdrop-filter` trên overlay, tạo theme Liquid Glass Pearl cho popover, định hình spotlight stage |
| `frontend/src/lib/onboarding/tourSteps.ts` | Cấu hình Tour | Chuyển Step 4 sang `[data-tour="news-bookmark-action"]`, cập nhật chính xác text và vị trí popover |
| `frontend/src/app/news/page.tsx` | Nâng cấp Giao diện | Gắn selector vào nút bookmark thật, bổ sung skeleton loader bảo toàn vị trí DOM 4 bước |
| `frontend/src/components/onboarding/OnboardingTour.tsx` | Kiến trúc Logic | Tích hợp smooth scrolling căn giữa phần tử, chèn nút "Bỏ qua" vào popover, cô lập sự kiện destroy |
| `frontend/src/components/onboarding/OnboardingProvider.tsx` | Quản lý State | Tránh auto-open khi có modal khác hoạt động, tối ưu khởi tạo sessionStorage cho test suite |
| `frontend/e2e/onboarding-tour-ux.spec.ts` | Kiểm thử E2E | 5 test cases Playwright chuyên sâu kiểm tra spotlight < 120px, không blur, responsive, bookmark action |
| `frontend/e2e/phase11-news-and-onboarding.spec.ts` | Kiểm định Hồi quy | 6 test cases E2E kiểm chứng toàn bộ luồng Bản tin và Onboarding /map, /news |

---

## 4. KẾT QUẢ KIỂM THỬ PLAYWRIGHT (VERIFICATION EVIDENCE)

### 4.1. Bộ test chuyên sâu `e2e/onboarding-tour-ux.spec.ts`
```bash
Running 5 tests using 1 worker

  ✓  1. /news tour Step 4 spotlights ONLY the bookmark button without global blur (2.6s)
  ✓  2. Skip button in popover dismisses tour and persists skipped status (2.2s)
  ✓  3. Onboarding Help button in header re-opens tour on demand (344ms)
  ✓  4. Responsive layout on Tablet (768px) and Mobile (390px) (1.4s)
  ✓  5. Actual bookmark click functionality is completely preserved (1.2s)

5 passed (8.7s)
```

### 4.2. Bộ test hồi quy `e2e/phase11-news-and-onboarding.spec.ts`
```bash
Running 6 tests using 1 worker

  ✓  1. Traffic News Center renders real articles, filters, search, and bookmarks on desktop (723ms)
  ✓  2. Traffic News Center is fully responsive on mobile without horizontal overflow (205ms)
  ✓  3. Landing Scene 02 is updated to Daily Traffic News experience (954ms)
  ✓  4. Driver.js interactive onboarding: Welcome dialog and 6 spotlight steps on /map (1.9s)
  ✓  5. Onboarding skip, no repeated intrusion, and re-opening from Help button (2.7s)
  ✓  6. Onboarding tour on mobile adapts correctly to small screens (1.1s)

6 passed (8.7s)
```

### 4.3. Kiểm thử Backend Python Core
```bash
14 passed in 4.46s (test_traffic_news, test_traffic_news_nlp_benchmark, test_yolo26n_motorcycle_recovery)
```

---

## 5. BẰNG CHỨNG HÌNH ẢNH (SCREENSHOT ARTIFACTS)

Các ảnh chụp màn hình kiểm thử thực tế đã được lưu giữ trong thư mục `docs/`:
1. `docs/news_tour_step4_bookmark_spotlight.png`: Bước 4 trên trang `/news` chiếu điểm gọn gàng và sắc nét vào nút Bookmark, nền toàn trang Soft Navy trong trẻo, không hề bị nhòe.
2. `docs/onboarding_tour_mobile_crisp.png`: Giao diện Onboarding trên thiết bị di động (390px), popover co giãn hoàn hảo không tràn viền màn hình.
3. `docs/onboarding_welcome_dialog.png`: Hộp thoại chào mừng Liquid Glass với hai tùy chọn "Bắt đầu hướng dẫn" và "Khám phá ngay".
4. `docs/onboarding_spotlight_destination.png`: Chiếu điểm chuẩn xác vào ô chọn điểm đến trên bản đồ `/map`.
5. `docs/onboarding_spotlight_camera_toggle.png`: Chiếu điểm vào nút bật/tắt camera giao thông trên bản đồ `/map`.

---

## 6. TUÂN THỦ NGUYÊN TẮC HỆ THỐNG
- **Zero-Mock Runtime:** 100% dữ liệu bài viết, vị trí camera và trạng thái lưu dấu trang hoạt động trên dữ liệu thật.
- **Core Protection:** Không thay đổi các thuật toán tìm đường OSRM, backend YOLO26n, camera ingestion hay Google OAuth.
- **Git Safety:** Tuân thủ tuyệt đối quy định không tự ý thực hiện `git commit` hay `git push`.

