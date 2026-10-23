# SafePathAI: quy tắc dữ liệu thật

1. Tuyến đường chỉ được trả từ OSRM đã xử lý dữ liệu OpenStreetMap thật. OSRM lỗi: trả `503 ROUTING_PROVIDER_UNAVAILABLE`; không có tuyến: `404 NO_ROUTE_FOUND`. Không nối A–B hay thêm anchor giả.
2. `alternatives=N` là yêu cầu ứng viên tối đa, không đảm bảo đủ N tuyến. Geometry và dist/ETA lấy từ cùng OSRM response; không tự gán OSM way ID từ node annotation.
3. Không có bằng chứng camera/thời tiết/triều đủ quyền, đủ mới và đúng vị trí thì rủi ro là `UNKNOWN` hoặc `UNAVAILABLE`. Không suy ra `SAFE`, `0 mm/h` hay mực triều từ việc thiếu dữ liệu.
4. Camera cần tọa độ xác minh; không gán tâm quận/TP.HCM. Chưa xác minh quyền ảnh thì không ingest/re-distribute. Không dùng cookie để vượt xác thực hay tắt TLS verification.
5. Inference chỉ được ghi là AI/model khi weights, preprocessing, validation và version được kiểm chứng. Heuristic không được mang nhãn ONNX/YOLO. Tỷ lệ pixel không phải độ sâu ngập.
6. Background worker mới được ingest dữ liệu. API tìm đường đọc nguồn đã xác minh; LLM chỉ giải thích evidence có sẵn, không thêm dữ kiện hoặc chọn đường.
7. Không có runtime mock, ảnh mẫu, sự kiện bão/ngập demo, seed SAFE, ETA dựng, kết quả benchmark chưa chạy. Unit fixture trong tests được phép để kiểm tra nhánh lỗi; E2E nghiệm thu phải gọi dịch vụ thật.
8. Giữ backend, frontend, PostGIS, Redis, OSRM, MapLibre và deck.gl. Mọi thay đổi phải kiểm tra contract và chạy test liên quan. Ghi riêng test bị chặn hoặc chưa chạy.
