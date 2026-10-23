# SỔ TAY VẬN HÀNH DỮ LIỆU THỰC (RUNBOOK REAL DATA & DEPLOYMENT)

Tài liệu này hướng dẫn chi tiết quy trình thiết lập từ đầu (cold start), chuẩn bị dữ liệu thực tế, khởi chạy các container, thực thi kiểm thử tích hợp E2E và đo kiểm hiệu năng cho SafePathAI.

---

## 1. Yêu cầu Môi trường & Hạ tầng

- **Hệ điều hành**: macOS (Apple Silicon / Intel) hoặc Linux (Ubuntu 22.04+).
- **Phần cứng đề xuất**: Tối thiểu 8 CPU Cores, 8 GB RAM (để chạy MLD OSRM và PostGIS Spatial Index).
- **Phần mềm bắt buộc**:
  - Docker Desktop hoặc Docker Engine (hỗ trợ Docker Compose v2).
  - Python 3.12+ (kèm môi trường ảo `.venv`).
  - Node.js 18+ (kèm `npm`).
  - Grafana k6 (`brew install k6` trên macOS).

---

## 2. Bước 1: Chuẩn bị Dữ liệu Định tuyến OSRM

Nếu thư mục `data/osrm/` chưa có đồ thị đã biên dịch:

```bash
# Tải PBF Việt Nam từ Geofabrik và biên dịch đồ thị MLD
chmod +x scripts/setup_osrm_hcm.sh
./scripts/setup_osrm_hcm.sh
```

Kiểm tra tính toàn vẹn của các file đồ thị:
```bash
ls -lh data/osrm/
# Đảm bảo có các file:
# - vietnam-latest.osrm (~1.1 GB)
# - vietnam-latest.osrm.cells (~1.3 GB)
# - vietnam-latest.osrm.partition (~700 MB)
# - vietnam-latest.osrm.mldgr (~1.4 GB)
```

---

## 3. Bước 2: Khởi chạy Hạ tầng Cơ sở Dữ liệu & Routing Engine

Khởi chạy 3 dịch vụ nền tảng:

```bash
# Lưu ý: Trên macOS, nếu cổng 5000 bị ControlCenter chiếm dụng, thiết lập OSRM_HOST_PORT=5001
export OSRM_HOST_PORT=5001

docker compose up -d postgis redis osrm
```

Xác nhận trạng thái hoạt động:
```bash
docker compose ps
# Cả 3 container postgis, redis, osrm phải ở trạng thái "healthy"

# Kiểm tra OSRM routing engine
./scripts/check_osrm.sh
```

---

## 4. Bước 3: Nạp Dữ liệu Mạng lưới Đường PostGIS & Điểm Ngập

Nếu cơ sở dữ liệu PostGIS vừa được khởi tạo mới:

```bash
# Import 343.610 đường OSM và phân tách 1.858.355 cạnh phân đoạn
./scripts/import_osm_roads_hcm.sh

# Kiểm tra dữ liệu đường trong PostGIS
docker compose exec -T postgis psql -U safepath -d safepath -c \
  "SELECT count(*) FROM road_segments; SELECT count(*) FROM road_edges;"
```

---

## 5. Bước 4: Khởi chạy Backend FastAPI

```bash
# Kích hoạt virtualenv
source .venv/bin/activate

# Cài đặt dependencies (bao gồm websockets và onnxruntime)
pip install -r requirements.txt

# Khởi chạy Uvicorn trên cổng 8000
# (OSRM_BASE_URL trỏ tới cổng host 5001 nếu chạy trên macOS)
OSRM_BASE_URL=http://localhost:5001 uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Kiểm tra sức khỏe hệ thống:
```bash
curl -s http://localhost:8000/api/v1/health | jq .
# Kết quả mong đợi:
# {"status":"healthy","database":"healthy","redis":"healthy","osrm":"available",...}
```

---

## 6. Bước 5: Khởi chạy Frontend Next.js

```bash
cd frontend

# Cài đặt dependencies
npm install

# Kiểm tra kiểu dữ liệu TypeScript
npx tsc --noEmit

# Build production bundle
npm run build

# Khởi chạy server production trên cổng 3100
npm run start -- -p 3100
```

Truy cập Dashboard tại: `http://localhost:3100`

---

## 7. Bước 6: Quy trình Kiểm thử Nghiệm thu Toàn diện

### A. Kiểm thử Bảo mật & Rà soát Lộ lọt Thông tin (Redaction Audit)
```bash
python3 scripts/security_and_redaction_check.py
# Kết quả: === ALL SECURITY & REDACTION CHECKS PASSED ===
```

### B. Kiểm thử Backend Toàn bộ 113 Test Cases (Pytest)
```bash
OSRM_LIVE_TESTS=1 OSM_ROAD_LIVE_TESTS=1 .venv/bin/pytest backend/tests/ -v
# Kết quả mong đợi: 108 passed, 5 skipped (0 failures)
```

### C. Kiểm thử Giao diện Thực tế E2E (Playwright)
```bash
cd frontend
npx playwright test
# Kết quả mong đợi: 3 passed, 1 skipped (0 failures)
```

### D. Kiểm thử Tải Cao Độ với 30 Người dùng Đồng thời (k6 Load Test)
```bash
k6 run load_tests/k6_route_search.js
# Kết quả thực tế đo kiểm:
# - Throughput: 13.43 requests/second (421 requests trong 30s)
# - Thành công: 97.6% (411/421)
# - Median Latency (p50): ~1.86s - 2.01s
# - 95th Percentile Latency (p95): ~3.26s - 3.49s
```

---

## 8. Xử lý Sự cố Thường gặp (Troubleshooting)

| Hiện tượng | Nguyên nhân | Giải pháp xử lý |
|---|---|---|
| **Cổng 5000 báo đã bị sử dụng** | macOS `ControlCenter` (AirPlay Receiver) chiếm cổng 5000 | Chạy OSRM trên cổng 5001: `OSRM_HOST_PORT=5001` và khai báo `OSRM_BASE_URL=http://localhost:5001` cho Backend. |
| **Lỗi WebSocket 404** | Uvicorn thiếu module giao thức WebSocket | Cài đặt `websockets`: `.venv/bin/pip install websockets` và khởi động lại Backend. |
| **Playwright báo lỗi timeout** | WebGL render và tải bản đồ OpenFreeMap cần thời gian khởi tạo | Trong test E2E, đặt `{ timeout: 15000 }` cho các locator bản đồ và tuyến đường. |
| **Lỗi 422 OUTSIDE_SERVICE_AREA** | Tọa độ tìm đường nằm ngoài ranh giới TP.HCM | Chọn các cặp tọa độ trong danh mục mẫu (Chợ Bến Thành, Landmark 81, Hàng Xanh, Tân Sơn Nhất, v.v.). |
| **Camera hiển thị UNKNOWN** | Chưa có feed quan trắc xác minh góc nhìn | Đây là hành vi đúng chuẩn **Zero-Mock** (không suy diễn an toàn khi chưa có bằng chứng). |

