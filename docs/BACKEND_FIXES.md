# Backend: các bản sửa và cách kiểm tra

Giữ cách sử dụng của ứng dụng seminar: không thêm đăng nhập, quyền sở hữu hay rate limit. Các endpoint vẫn là `POST/GET /api/urls` và `GET/DELETE /api/urls/{short_code}`.

## Những điểm đã sửa

- `CACHE_TTL_SECONDS` được parse thành số nguyên, mặc định 3600; 0 tắt việc ghi cache, giá trị âm bị từ chối.
- Tạo link chỉ retry khi lỗi unique constraint của **short_code**; tối đa 10 lần, rollback giữa các lần thử. Lỗi integrity khác không bị coi là collision.
- Redirect và xóa cùng dùng service. Cache MISS/HIT, TTL và invalidation chạy trên endpoint thật.
- Redirect dùng SQL UPDATE có điều kiện chưa hết hạn và RETURNING. Không trả 302 nếu bản ghi đã biến mất/hết hạn trước lúc cập nhật, không cộng click cho link hết hạn. Cache cũ cũng phải khớp destination đang có trong DB.
- Cache HIT vẫn cập nhật click trong PostgreSQL; Redis không thay thế DB. Redis lỗi thì fallback DB; DB lỗi thì trả 503, không giả thành 404.
- `active` được tính từ `expires_at`, không luôn là true. Trường nhập sai như `expired_at` trả 422 thay vì bị bỏ qua và tự tạo link 30 ngày.
- List có `limit` (1–100, mặc định 20) và `offset` (không âm), sắp theo thời điểm tạo mới nhất. Giao diện có Previous/Next và xử lý trang trống sau khi xóa.
- Không in database URL/mật khẩu. Session rollback khi lỗi; log database không chứa tham số nhạy cảm.
- Schema ORM dùng UUID và `expires_at`. Test health dùng `/app/health` và `status=healthy`.

## Chạy kiểm thử

Từ thư mục gốc, với môi trường Python/Node đã cài dependencies:

```powershell
Push-Location backend
.\.venv\Scripts\python.exe -m pytest -q
Pop-Location
Push-Location frontend
node --test tests/api.test.mjs
npm.cmd run build
Pop-Location
```

Backend tests tự tạo database SQLite in-memory riêng cho từng test và giả lập Redis; không ghi vào PostgreSQL hoặc Redis local. Các test bao gồm validation, thời hạn, CRUD, retry, cache hỏng, TTL, rollback và xóa đồng thời trước UPDATE.

Browser tests trong `frontend/tests/e2e/url-shortener.spec.js` kiểm tra luồng form, Reset, Refresh, Go, Back to top, lỗi API và phân trang. Cần Playwright cùng frontend đang chạy; `PLAYWRIGHT_BASE_URL` phải trỏ tới origin phục vụ trang, và bundle dùng API cùng origin để chạy bộ test với intercepted HTTP.

## Schema và chạy lại ứng dụng

Không cần thêm cột quản lý/chủ sở hữu. Các thay đổi xác thực đã được gỡ theo yêu cầu; không cần chạy hai câu SQL thêm `owner_token_hash` từng được đề xuất.

Lệnh `Base.metadata.create_all` trong README áp dụng cho DB mới, không tự migrate database cũ. Nếu DB đang có `id UUID` và `expires_at TIMESTAMPTZ`, không cần migration cho bản sửa này. Nếu vẫn có SERIAL hoặc `expired_at`, cần migration dữ liệu riêng trước khi dùng model hiện tại; không xóa database để sửa lỗi.

Sau khi cập nhật source, khởi động lại Uvicorn/Next dev. Giữ `REDIS_URL=` để chạy không có Redis hoặc đặt URL đúng khi Redis đã sẵn sàng.
