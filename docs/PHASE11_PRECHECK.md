# BÁO CÁO KIỂM TOÁN TIỀN TRIỂN KHAI GIAI ĐOẠN 11 (PHASE 11 PRE-CHECK)
**SafePathAI — Daily Traffic News Center & Interactive User Onboarding (Driver.js)**

---

## 1. TÌNH TRẠNG WORKING TREE VÀ THAY ĐỔI CHƯA COMMIT
- **Git Branch:** `main` (Up to date with origin/main).
- **Trạng thái:** Toàn bộ thay đổi của Phase 10 đã được stage an toàn:
  - Backend models (`TrafficNewsArticle`), schemas (`contracts.py`), config, scheduler, URL resolver, adapters (`news_sources/`), NLP benchmark 55 ca, test suite 154 bài (140 passed, 14 skipped).
  - Không có xung đột hoặc file ghi đè.
  - Tuân thủ nghiêm ngặt nguyên tắc **KHÔNG COMMIT, KHÔNG PUSH** trừ khi người dùng yêu cầu rõ ràng.

---

## 2. KHẢO SÁT CÁC FILE TRANG FRONTEND
1. **`frontend/src/app/page.tsx` (Landing Page):**
   - Đang có 4 scenes:
     - Scene 00: Hero (Nhìn rõ thành phố, chủ động lối đi an toàn, 796 camera metrics).
     - Scene 01: Mắt thần 796 Camera & YOLO Vision AI.
     - Scene 02: Tình báo thời tiết & Triều cường sông Sài Gòn (Open-Meteo & Trạm Phú An/Nhà Bè).
     - Scene 03: Điều hướng thông minh tránh ngập (OSRM simulation comparison).
   - Navbar landing hiện có nút "Thời tiết & Triều" trỏ đến Scene 02.
   - Sẽ nâng cấp Scene 02 thành **"02 / BẢN TIN GIAO THÔNG THÀNH PHỐ"** với CTA dẫn sang `/news`, đồng thời cập nhật link navbar thành "Bản tin giao thông" trỏ đến `/news`.
2. **`frontend/src/app/map/page.tsx` & `SpatialDashboard.tsx`:**
   - Hoạt động ổn định với MapLibre 3.6.2, OSRM multi-route, VoiceHUD, và GlassToggle camera switch.
   - Các điểm neo phần tử (spotlight targets) đã được xác định:
     - Điểm xuất phát: `[data-testid="origin-combobox"]`
     - Điểm đến: `[data-testid="destination-combobox"]`
     - Nút tìm tuyến: button text "Tìm tuyến đường" / selector tương ứng
     - Công cụ bật/tắt camera: `button[role="switch"][aria-label="Hiển thị camera"]`
     - Hướng dẫn di chuyển: `NavigationGuidance`
     - Link Bản tin giao thông trong navbar / floating controls
3. **`frontend/src/app/dashboard/page.tsx` (Trang cá nhân):**
   - Lưu trữ hành trình cá nhân, địa điểm đã lưu, cài đặt xe của tài khoản.
   - Phân biệt rành mạch: Không nhầm lẫn trang cá nhân với trang Bản tin giao thông cộng đồng (`/news`).
4. **`frontend/src/app/monitor/page.tsx` (Quan trắc Camera):**
   - Giám sát 796 camera với chu kỳ cập nhật 30 phút, lọc quận, tìm kiếm, modal kiểm chứng.
5. **`frontend/src/app/layout.tsx`:**
   - Đang bọc `AuthProvider`, tích hợp CSS Liquid Glass và Pearl Aurora. Sẽ tích hợp `OnboardingProvider` an toàn sau hydration.

---

## 3. KHẢO SÁT BACKEND NEWS PIPELINE & ADAPTERS
1. **`backend/app/services/traffic_news.py`:**
   - Đã tích hợp `fetch_aggregated_hcm_traffic_news()`, cache Redis 15 phút, lưu trữ PostgreSQL `traffic_news_articles`.
   - Có `is_article_eligible_for_route_risk()` (Rule 6: loại bỏ tin cũ quá 3h, tin không có tọa độ, tin dự báo/hồi tưởng).
   - Đã có `get_nearby_traffic_news()` và `list_all_traffic_news()`.
   - Cần bổ sung các endpoint mở rộng cho trang tin:
     - `GET /api/v1/traffic-news/highlights`: Lấy các tin nổi bật có độ tin cậy cao, ảnh thật, chưa hết hạn.
     - `GET /api/v1/traffic-news/summary`: Thống kê số lượng theo danh mục sự cố, số bài 24h, tình trạng nguồn tin.
     - Mở rộng `list_all_traffic_news()`: hỗ trợ lọc theo timeframe (24h, 7 ngày, 30 ngày), query tìm kiếm địa danh/tên đường, và trạng thái sự cố.
     - Trích xuất `image_url` từ RSS `<enclosure>` và thẻ `<img>` của bài viết gốc nếu có.
2. **`backend/app/services/news_sources/`:**
   - `vnexpress_rss.py`: Lấy RSS Thời sự VnExpress, lọc ngữ cảnh giao thông TP.HCM, phân tích ngày RFC 2822 chuẩn.
   - `tuoitre_rss.py`: Lấy RSS Thời sự Tuổi Trẻ, trích xuất sự cố giao thông đô thị TP.HCM.
   - `hcm_traffic_portal.py`: Cổng GTVT TP.HCM với cơ chế xử lý lỗi an toàn.
   - `official_alerts.py`: Cảnh báo tự động từ cảm biến triều cường (> 1.50m) và lượng mưa (> 20mm/h).
   - `nlp_classifier.py`: Phân loại 7 nhóm từ khóa, chuẩn hóa NFC, phát hiện phủ định trong mệnh đề, 5 trạng thái thời gian.
   - `hcm_geocoding.py`: Chỉ mục động PostGIS `road_segments` (33.800+ đoạn đường), 796 camera và danh mục địa danh TP.HCM.

---

## 4. KHẢO SÁT THƯ VIỆN DRIVER.JS
- Thư viện `driver.js` v1.x hỗ trợ cấu hình TypeScript native, popovers có thể tùy biến CSS hoàn toàn.
- Cần cài đặt vào `frontend/` qua `npm install driver.js`.
- Cần đảm bảo Driver.js chỉ khởi chạy client-side (`useEffect`), không can thiệp SSR, dọn dẹp sạch sẽ khi chuyển route.
- Tạo các component trong `frontend/src/components/onboarding/` và style Pearl Aurora Liquid Glass trong `frontend/src/styles/onboarding.css`.

---

## 5. KẾ HOẠCH TRIỂN KHAI THEO THỨ TỰ (EXECUTION SEQUENCE)
1. **News Backend:** Mở rộng trích xuất ảnh, thêm các endpoint highlights, summary, timeframe & search filters, bổ sung tests backend.
2. **News Frontend (`/news`):** Thiết kế trang `frontend/src/app/news/page.tsx` chuẩn Pearl Aurora Liquid Glass với 5 khối chức năng A-E và bộ lọc đầy đủ.
3. **Landing Page:** Thay thế Scene 02 bằng trải nghiệm bản tin giao thông, cập nhật navbar.
4. **Driver.js Onboarding:** Cài đặt `driver.js`, xây dựng state quản lý v1 trong localStorage/preferences, thiết kế hand pointer/pulse animation, tạo tour cho `/map` và `/news`.
5. **Kiểm thử E2E & Chụp Screenshots:** Kiểm tra đầy đủ 10 tiêu chí tin tức + 12 tiêu chí onboarding bằng Playwright, chụp screenshot lưu vào `frontend/docs/`.

