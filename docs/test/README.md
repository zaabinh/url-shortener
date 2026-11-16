# Tổng hợp kiểm thử URL Shortener

Ngày đối chiếu source và xác minh: **16/11/2026**.

Short code tùy chọn và width ô URL theo nội dung đã được áp dụng vào source. Tài liệu thiết kế ban đầu: [OPTIONAL_SHORT_CODE.md](../OPTIONAL_SHORT_CODE.md).

Tài liệu liệt kê các trường hợp có trong test suite hiện tại, assertion, cách chạy và giới hạn. Có code test không đồng nghĩa đã chạy thành công trên mọi môi trường; kết quả thực sự xác nhận trong lần cập nhật này nằm ở phần 7.

## 1. Tổng quan

| Bộ test | Vị trí | Số test của runner | Môi trường |
|---|---|---:|---|
| Backend | backend/tests/test_*.py | 54 | FastAPI/SQLAlchemy trong process, SQLite in-memory, Redis giả lập |
| Frontend API helper | frontend/tests/api.test.mjs | 3 | Node.js, mock fetch |
| Frontend Playwright | frontend/tests/e2e/url-shortener.spec.js | 18 | 16 test có browser, 2 test helper chạy Node; API giả lập |
| Live E2E | frontend/tests/e2e-live/shortener.spec.js | 1 | Browser, frontend, backend và database thật của backend đang chạy |
| **Tổng** | | **76** | Không phải số assertion |

Một test có thể chứa nhiều assertion/bước. Các hàng chi tiết bên dưới không được cộng lần nữa vào tổng trên.

| Chức năng | Method / endpoint hiện tại |
|---|---|
| Health | GET /app/health |
| Tạo | POST /api/urls |
| Danh sách | GET /api/urls?limit=...&offset=... |
| Xóa | DELETE /api/urls/{short_code} |
| Redirect | GET /{short_code} |

## 2. Backend: 54 test

Fixtures tại [conftest.py](../../backend/tests/conftest.py) đặt DATABASE_URL=sqlite://, tắt Redis thật, tạo engine/schema/session mới cho từng test và override dependency get_db. Sau test đóng session/engine, gỡ dependency override. Không cần chạy Uvicorn/PostgreSQL/Redis cho bộ này.

### 2.1. Health: 1 test

Nguồn: [test_health.py](../../backend/tests/test_health.py).

| ID | Test | Thao tác và assertion |
|---|---|---|
| BE-01 | test_health | GET /app/health trả 200, JSON đúng {"status":"healthy"}. Chỉ kiểm tra liveness HTTP. |

### 2.2. CRUD, validation và pagination: 10 test

Nguồn: [test_urls.py](../../backend/tests/test_urls.py).

| ID | Test / dữ liệu parametrization | Thao tác và assertion |
|---|---|---|
| BE-02 | test_create_list_and_delete | POST trả 201, code dài 7, active=true, Cache-Control=no-store; list có cùng id; DELETE trả 204, xóa lại trả 404. |
| BE-03 | test_rejects_invalid_input: javascript URL | Trả 422. |
| BE-04 | Cùng test: ftp URL | Trả 422. |
| BE-05 | Cùng test: URL dài hơn 2048 ký tự | Trả 422. |
| BE-06 | Cùng test: expiration không timezone | Trả 422. |
| BE-07 | Cùng test: expiration quá khứ | Trả 422. |
| BE-08 | test_unknown_expiration_field_is_not_silently_ignored | Gửi nhầm expired_at thay vì expires_at phải trả 422. |
| BE-09 | test_default_expiration | Bỏ expires_at: POST 201, thời hạn còn lại lớn hơn 29 ngày và không quá 30 ngày. |
| BE-10 | test_expired_response_is_inactive | Đổi expiration trong DB thành quá khứ; list trả active=false. |
| BE-11 | test_pagination_is_ordered_by_creation_time | 5 bản ghi có thời điểm tạo khác nhau: limit=2&offset=1 trả page3, page2; limit=101, limit=0, offset=-1 đều trả 422. |

### 2.3. Redirect và click count: 6 test

Nguồn: [test_redirect.py](../../backend/tests/test_redirect.py).

| ID | Test / dữ liệu parametrization | Thao tác và assertion |
|---|---|---|
| BE-12 | test_public_redirect_increments_clicks: aware datetime | GET /{code}, không follow redirect: 302, Location đúng, Cache-Control=no-store; click tăng lên 1. |
| BE-13 | Cùng test: naive datetime legacy | Cùng kết quả 302/header/click. SQLite không bảo toàn đầy đủ timezone như PostgreSQL. |
| BE-14 | test_expired_redirect_never_increments | Link hết hạn trả 410, click vẫn 0. |
| BE-15 | test_missing_redirect | Code không tồn tại trả 404. |
| BE-16 | test_delete_between_lookup_and_update_does_not_redirect | Hook SQL xóa bản ghi trước UPDATE click; xác nhận hook chạy và trả 404. Là mô phỏng thao tác xen kẽ, không phải load test nhiều thread. |
| BE-17 | test_many_redirects_have_exact_click_count | 12 GET tuần tự đều trả 302; click cuối cùng bằng 12. |

### 2.4. Service, cache và xử lý lỗi: 16 test

Nguồn: [test_url_service.py](../../backend/tests/test_url_service.py).

| ID | Test / dữ liệu parametrization | Thao tác và assertion |
|---|---|---|
| BE-18 | test_collision_retries_and_succeeds | Sinh code đã tồn tại rồi code mới; tạo thành công code mới, DB có 2 bản ghi. |
| BE-19 | test_collision_exhaustion_is_safe_503 | Luôn sinh code trùng: POST trả 503, số lần sinh đúng MAX_ATTEMPTS. |
| BE-20 | test_non_collision_integrity_error_is_not_retried | Lỗi NOT NULL được raise; commit một lần, rollback một lần. |
| BE-21 | test_postgres_collision_classification: ix_urls_short_code | Exception mô phỏng SQLSTATE 23505 được coi là collision. |
| BE-22 | Cùng test: urls_short_code_key | Được coi là collision. |
| BE-23 | Cùng test: urls_pkey | Không coi primary-key violation là short-code collision. |
| BE-24 | test_ttl_is_typed_and_validated | CACHE_TTL_SECONDS=12 thành int 12; giá trị -1 gây validation error. |
| BE-25 | test_cache_miss_hit_and_delete_invalidation | MISS trả 302, cache đúng key/destination với 0 < TTL <= 90; HIT trả 302, không SET thêm, click=2; DELETE 204 invalidate key; redirect sau xóa 404. |
| BE-26 | test_stale_cache_cannot_redirect_a_reused_code | Cache destination cũ: Location phải lấy destination hiện tại của DB và cache được SET lại một lần. |
| BE-27 | test_redis_failures_fall_back_to_database: get lỗi | ConnectionError vẫn cho redirect 302, delete 204, redirect sau xóa 404. |
| BE-28 | Cùng test: set lỗi | Các kết quả HTTP vẫn đúng khi ghi cache lỗi. |
| BE-29 | Cùng test: delete lỗi | Các kết quả HTTP vẫn đúng khi invalidation lỗi. |
| BE-30 | test_cached_expired_record_does_not_redirect | Cache còn nhưng DB hết hạn: 410, invalidate key, click=0. |
| BE-31 | test_zero_ttl_disables_cache_writes | TTL=0: redirect 302 nhưng không gọi cache SET. |
| BE-32 | test_database_error_response_and_logs_hide_secrets | OperationalError khi list: 503, mật khẩu giả không xuất hiện trong response hoặc log được capture. |
| BE-33 | test_db_dependency_rolls_back_and_closes | Ném lỗi vào dependency generator: lỗi truyền tiếp, rollback một lần, close một lần. |

### 2.5. Custom short code: 21 trường hợp runner

Nguồn: [test_urls.py](../../backend/tests/test_urls.py) và [test_url_service.py](../../backend/tests/test_url_service.py).

| ID | Test / dữ liệu parametrization | Thao tác và assertion |
|---|---|---|
| BE-34 | test_create_custom_short_code | Tạo đúng `myLink2026`; GET `/myLink2026` trả 302 và Location đúng. |
| BE-35–37 | test_empty_custom_code_generates_random_code | `null`, chuỗi rỗng và khoảng trắng đều sinh code ngẫu nhiên dài 7. |
| BE-38–47 | test_rejects_invalid_custom_code | Từ chối slash, khoảng trắng giữa chuỗi, dấu gạch, quá 32 ký tự, kiểu số và các tên route reserved không phân biệt hoa thường. |
| BE-48 | test_duplicate_custom_code_returns_409 | Code trùng trả 409, Cache-Control=no-store và không tạo thêm bản ghi. |
| BE-49–50 | test_custom_code_is_trimmed_and_accepts_max_length | Trim khoảng trắng đầu/cuối và chấp nhận đúng 32 ký tự. |
| BE-51 | test_custom_codes_are_case_sensitive | `myCode` và `MyCode` là hai mã hợp lệ khác nhau. |
| BE-52 | test_expired_custom_code_is_still_reserved | Code của bản ghi hết hạn vẫn trả 409. |
| BE-53 | test_reserved_generated_code_consumes_an_attempt | Generator trả `api` thì bỏ qua, lần sau tạo bằng code hợp lệ; reserved code vẫn tiêu tốn một attempt. |
| BE-54 | test_custom_code_does_not_call_generator | Custom code hợp lệ được dùng trực tiếp, không gọi generator. |

## 3. Frontend API helper: 3 test

Nguồn: [api.test.mjs](../../frontend/tests/api.test.mjs). Tên runner: `create and list use the API redirect path and backend expiration field`. Tên vẫn có chữ API redirect; assertion hiện dùng redirect root /{code}.

Test import helper với NEXT_PUBLIC_API_BASE_URL=https://short.example và mock globalThis.fetch. Sau test khôi phục environment/fetch.

| ID | Trường hợp | Assertion |
|---|---|---|
| FE-01 | Tạo URL | Request tới https://short.example/api/urls, method POST. |
| FE-02 | Payload | Body chứa đúng original_url và expires_at. |
| FE-03 | Link sau tạo | Code abc123 được chuyển thành https://short.example/abc123. |
| FE-04 | List mặc định | Request tới /api/urls?limit=32&offset=0. |
| FE-05 | Map danh sách | Bổ sung short_url tại root và giữ nguyên expires_at. |
| FE-06 | Code không hợp lệ | getShortUrl(undefined) ném lỗi có nội dung invalid short code. |
| FE-07 | Encode code | getShortUrl('a/b') tạo segment a%2Fb; không chứng minh backend chấp nhận code chứa slash. |
| FE-08 | Custom code | Trim `  myCode  `, gửi `short_code=myCode` và trả link `/myCode`. |
| FE-09 | Custom code rỗng | Chuỗi chỉ có khoảng trắng không tạo field `short_code` trong payload. |
| FE-10 | Conflict 409 | Reject bằng thông báo an toàn, có hướng xử lý và không lộ detail backend. |

## 4. Frontend Playwright với API giả lập: 18 test

Nguồn: [url-shortener.spec.js](../../frontend/tests/e2e/url-shortener.spec.js). Config: [playwright.config.js](../../frontend/playwright.config.js).

Các test có browser intercept /api/urls bằng page.route, không gọi backend/PostgreSQL thật. Hai test helper chạy Node trong cùng file không mở browser. Config mặc định dùng Chromium, viewport 1440×900, reduced motion.

| ID | Tên test | Kịch bản và assertion |
|---|---|---|
| UI-01 | creates a short URL and sends expiration in UTC | Nhập URL/thời hạn, Shorten: thấy /{code}; chỉ một POST, body đúng destination và expiration UTC kết thúc bằng Z. |
| UI-02 | does not send an invalid URL | URL sai: browser có typeMismatch, không POST. |
| UI-03 | shows a safe validation error when creation fails | Mock POST 422 có chi tiết nhạy cảm: UI hiện thông báo validation, không hiện SECRET; list rỗng, một POST. |
| UI-04 | refreshes the recent URL list after a successful create | Tạo thành công: tổng hai lần list và thấy card mới. |
| UI-05 | deletes a recent short URL | Hiện card, bấm Delete rồi Yes: card biến mất, ghi nhận DELETE đúng code. |
| UI-06 | keeps a URL after delete fails and allows retry | DELETE đầu 503: card còn và có lỗi; Retry delete thành công: card biến mất, tổng hai request. |
| UI-07 | requires reset before creating another mapping | Tạo rồi xóa card; Expand/Shorten vẫn dùng link đã tạo, không POST thêm; Reset xóa URL/thời hạn; nhập lại tạo code mới; tổng hai POST và một DELETE. |
| UI-08 | marks expired links as HTTP 410 Gone and disables navigation | Card quá hạn hiện nhãn Expired và short URL dạng text, không còn anchor mang URL đó. Không gửi HTTP thật để xác minh 410. |
| UI-09 | offers retry after a list timeout and displays the refreshed data | List đầu bị abort: UI hiện lỗi/Retry; retry trả dữ liệu: thấy short/original URL, tổng hai request. |
| UI-10 | rejects a non-array list response with a TypeError | Test Node: mock trả object thay array, listUrls reject TypeError với thông báo đúng. |
| UI-11 | maps list and delete timeout errors to retryable messages | Test Node: mock ném TimeoutError, list/delete reject với thông báo timeout tương ứng. |
| UI-12 | refreshes cards and exposes Go and Back to top navigation | Go có href /{code}; Refresh tải card mới; Back to top ban đầu chưa có, xuất hiện khi xuống Recent URLs và có position fixed; bấm về scrollY=0, nút biến mất. Không mở website đích. |
| UI-13 | paginates recent URLs without dropping older records | Mock 25 bản ghi: trang đầu 20 card, Next còn 5 và nhãn Page 2; Previous về 20 card. |
| UI-14 | creates a custom code and resets it | Gửi custom code, khóa field sau tạo, Shorten/Expand không POST lại; Reset xóa và mở lại field. |
| UI-15 | rejects an invalid custom code without posting | Pattern sai bị browser từ chối và không POST. |
| UI-16 | keeps form values after a custom-code conflict and allows retry | 409 giữ URL, expiration và code; sửa code rồi tạo lại thành công. |
| UI-17 | fits the shortened URL control to text plus chrome | Width thực tế gần bằng text đo được cộng padding, border, button và gap, sai số tối đa 3px. |
| UI-18 | clamps the shortened URL control on a mobile viewport | Viewport 390px: control không vượt parent và document không tràn ngang. |

listUrls mặc định 32 nhưng RecentUrls truyền limit=PAGE_SIZE+1=21, hiển thị 20 và dùng bản ghi thứ 21 để biết còn trang tiếp. Hai con số không mâu thuẫn.

## 5. Live E2E: 1 test

Nguồn: [shortener.spec.js](../../frontend/tests/e2e-live/shortener.spec.js). Config: [playwright.live.config.mjs](../../frontend/playwright.live.config.mjs). Tên test: `creates a URL, redirects and deletes it`.

| Bước | Thao tác | Assertion |
|---|---|---|
| 1 | Mở frontend http://localhost:3000; nhập URL đích, custom code duy nhất theo timestamp và thời hạn tương lai | Chuẩn bị dữ liệu qua form thật. |
| 2 | Bấm Shorten, đợi response POST /api/urls | 201; short_code trả về đúng custom code đã nhập. |
| 3 | Đọc ô URL | Đúng http://localhost:8000/{short_code}. |
| 4 | GET short URL bằng Playwright request, maxRedirects=0 | 302, Location=https://example.com/e2e. |
| 5 | DELETE /api/urls/{short_code} | 204. |
| 6 | GET short URL lần nữa, không follow redirect | 404. |
| 7 | finally cleanup | Nếu lấy được code, thử DELETE để dọn kể cả khi assertion lỗi; cleanup không có assertion riêng. |

Test đi qua UI tạo URL thật và backend/database thật. Redirect/xóa dùng HTTP client của Playwright, không bấm Go/Delete trên UI. Không truy cập website bên ngoài; không assert click count, Redis HIT/MISS hay expiration 410.

## 6. Cách chạy

### 6.1. Backend

PowerShell, bắt đầu từ thư mục gốc repository:

```powershell
Push-Location backend
try {
    .\.venv\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r requirements-dev.txt
    .\.venv\Scripts\python.exe -m pytest -q
} finally {
    Pop-Location
}
```

Cần virtualenv đã tạo. Không cần server/database thật. Từ backend, chạy riêng hoặc xem danh sách:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_redirect.py -v
.\.venv\Scripts\python.exe -m pytest --collect-only -q
```

### 6.2. Frontend API helper và browser tests có mock

Từ root:

```powershell
Push-Location frontend
try {
    npm.cmd ci --ignore-scripts
    node --test tests/api.test.mjs
    npm.cmd exec --no -- playwright install chromium
    node -e "const r=require('node:child_process').spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{stdio:'inherit',env:{...process.env,NEXT_PUBLIC_API_BASE_URL:''}});process.exit(r.status??1)"
    npm.cmd run test:e2e
} finally {
    Pop-Location
}
```

Build cần API cùng origin để mock/intercept đúng. Lệnh Node truyền chuỗi rỗng trực tiếp cho process build, tránh PowerShell xóa biến khi gán rỗng.

Playwright tự chạy static server tại http://127.0.0.1:8080 từ frontend/out; cần Python trên PATH và port 8080 trống. Ngoài CI config cho phép reuse server, nên tránh dùng nhầm bundle/server cũ. Nếu có PLAYWRIGHT_BASE_URL thì dùng origin đó và không tự start server; bundle vẫn phải phù hợp mock cùng origin.

Từ frontend:

```powershell
npm.cmd run test:e2e -- --list
npm.cmd run test:e2e -- --grep "requires reset"
npm.cmd run test:e2e -- --headed
```

### 6.3. Live E2E

Dùng database test riêng đã provision, cấu hình DATABASE_URL của backend trỏ vào đó. Live test ghi/xóa dữ liệu của backend đang chạy; fixtures SQLite của pytest không áp dụng. Redis có thể tắt qua cấu hình REDIS_URL= của backend; live test không kiểm tra cache.

Terminal backend, từ root, sau khi cấu hình môi trường test:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m app.db.init_db
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

init_db chỉ tạo bảng còn thiếu, không migrate bảng cũ. Backend phải chạy port 8000 và cho phép CORS origin http://localhost:3000.

Terminal frontend, từ root:

```powershell
Set-Location frontend
$env:NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8000'
npm.cmd run dev
```

Terminal test, từ root:

```powershell
Push-Location frontend
try {
    npm.cmd exec --no -- playwright install chromium
    npm.cmd run test:e2e -- --config=playwright.live.config.mjs
} finally {
    Pop-Location
}
```

Live config không tự khởi động server. File test phải ở tests/e2e-live, đúng testDir; đặt nhầm vào tests/e2e sẽ làm live runner báo No tests found và trộn live test vào bộ mock.

### 6.4. CI

[ci.yml](../../.github/workflows/ci.yml) chạy backend pytest, frontend API helper, production build và Playwright mặc định. Python cài lock có hash, npm dùng npm ci; Playwright gọi binary đã cài. Live E2E chưa nằm trong CI vì chưa provision/khởi động hệ thống thật cho suite đó.

## 7. Kết quả xác minh trong lần cập nhật này

| Lệnh / bộ test | Kết quả ngày 16/11/2026 |
|---|---|
| Backend pytest -q | **54 passed**, một StarletteDeprecationWarning về httpx. |
| Node node --test tests/api.test.mjs | **3 passed**. |
| Frontend production build | **Thành công** với Next.js 16.4.2. |
| Playwright mặc định --workers=1 | **18 passed**. |
| Playwright live config --list | Phát hiện **1 test**; chưa chạy live E2E với database thật trong lượt này. |

Warning httpx không phải test failure. Dev dependency hiện vẫn khóa httpx; chuyển sang httpx2 cần cập nhật dependency input/lock và chạy lại test. Build thành công hoặc --list thành công không chứng minh test runtime đã pass.

## 8. Giới hạn phạm vi

- Backend dùng SQLite và exception PostgreSQL mô phỏng; chưa chứng minh đầy đủ PostgreSQL/Redis thật hoặc tải đồng thời. Test 12 redirect chạy tuần tự.
- Browser có mock API không kiểm tra backend/database thật. Live test mới bao phủ tạo, redirect và xóa; chưa assert 410, pagination, Redis hoặc persistence.
- Go mới kiểm tra href, chưa kiểm tra tab mới truy cập đích. Chưa có test tự động riêng cho copy clipboard, các chip 1 day/1 week/1 month hoặc ma trận nhiều trình duyệt/thiết bị; auto-fit hiện được kiểm tra ở desktop và viewport 390px.
- Không cộng các kiểm tra Docker thủ công hoặc ví dụ smoke trong walkthrough vào 76 test ở đây; bảng chỉ kiểm kê các test file hiện có.

Khi thêm/sửa test, cập nhật hàng tương ứng và kết quả chạy có ngày/môi trường. Không ghi pass chỉ vì đã thêm code test.

## 9. Docker integration checks (17 November 2026)

These opt-in checks use real PostgreSQL and Redis rather than pytest's SQLite and
mocked cache. They are separate from the original inventory of 76 tests above:
two HTTP smoke cases and four cache/outage cases, six additional unique cases.
Running the smoke suite against both backend and Nginx exercises two HTTP paths
without creating new unique business test cases.

| Source / mode | Cases | Assertions |
|---|---|---|
| `backend/tests/smoke_api.py` | 2 | Create/list/302/Location/counter/delete/404; expiration 410 |
| `backend/tests/docker_cache.py` | 3 | MISS/HIT/clicks/delete invalidation; TTL and 410 without extra clicks; stale cached destination repaired |
| `backend/tests/docker_cache.py --fallback` | 1 | Redis is genuinely unavailable; active redirects still return 302, counters increase exactly, delete and 404 work |

```powershell
docker compose up -d --build --wait --wait-timeout 180
docker compose --profile test build tests
docker compose --profile test run --rm --no-deps tests
docker compose --profile test run --rm --no-deps -e SMOKE_BASE_URL=http://frontend:8080 tests
docker compose --profile test run --rm --no-deps tests python tests/docker_cache.py
docker compose stop redis
try {
    docker compose --profile test run --rm --no-deps tests python tests/docker_cache.py --fallback
    if ($LASTEXITCODE -ne 0) { throw 'Redis outage test failed' }
} finally {
    docker compose start redis
}
```

Run fallback only on a demo/test stack: it intentionally stops Redis. The test
scripts delete only their own records and keys. They do not flush databases.
The Compose test profile supplies real DB/cache settings and network access.
`.github/workflows/docker-smoke.yml` runs these checks in a disposable CI job;
its cleanup deletes only that job's isolated data volume.

To run the existing live browser case through Docker's Nginx entry point:

```powershell
$env:PLAYWRIGHT_LIVE_BASE_URL = 'http://localhost:8080'
$env:PLAYWRIGHT_LIVE_API_URL = 'http://localhost:8080'
Push-Location frontend
try { npm.cmd run test:e2e -- --config=playwright.live.config.mjs }
finally {
    Pop-Location
    Remove-Item Env:PLAYWRIGHT_LIVE_BASE_URL, Env:PLAYWRIGHT_LIVE_API_URL
}
```

Local defaults are unchanged. Observed on the isolated `url-shortener-verify`
project at port 18080: backend 54 passed, HTTP smoke 2 passed on each path,
cache 3 passed, outage 1 passed, live browser 1 passed. Both CI workflow files
passed actionlint 1.7.7. Hosted GitHub Actions execution is not claimed here.
