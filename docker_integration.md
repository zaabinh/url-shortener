# Docker từ local đến hệ thống nhiều container: URL Shortener

Tài liệu thực hành và lời dẫn cho 11 phần seminar. Người học vừa chạy ứng dụng, tạo lỗi có kiểm soát, quan sát, rồi dùng một thành phần Docker để giải quyết lỗi đó.

**Đầu vào:** source code của repository này, đã có giao diện Next.js, FastAPI, SQLAlchemy và model URL dùng UUID. **Đầu ra:** frontend Nginx, backend FastAPI, PostgreSQL và Redis chạy bằng Compose, có kiểm thử, network, volume và các git tag để diễn lại demo.

Đây là **hướng dẫn triển khai theo từng bước**, không phải thông báo rằng những file minh họa bên dưới đã được áp dụng vào repository. Các lệnh commit/tag là để người học thực hiện sau khi hoàn thành checkpoint; không gắn tất cả tag lên một commit cuối cùng.

## Mục lục

- [0. Chuẩn bị và quy ước](#0-chuẩn-bị-và-quy-ước)
- [1. Mở đầu: It works on my machine](#1-mở-đầu-it-works-on-my-machine)
- [2. Tổng quan Docker và containerization](#2-tổng-quan-docker-và-containerization)
- [3. Docker hóa backend](#3-docker-hóa-backend)
- [4. Port mapping](#4-port-mapping)
- [5. Registry và PostgreSQL container](#5-registry-và-postgresql-container)
- [6. Docker Network](#6-docker-network)
- [7. Docker Volume](#7-docker-volume)
- [8. Docker Compose và frontend container](#8-docker-compose-và-frontend-container)
- [9. Mở rộng với Redis](#9-mở-rộng-với-redis)
- [10. Docker architecture, test và CI](#10-docker-architecture-test-và-ci)
- [11. Kết thúc và Q&A](#11-kết-thúc-và-qa)
- [Phụ lục: xử lý lỗi và tài liệu chính thức](#phụ-lục-xử-lý-lỗi-và-tài-liệu-chính-thức)

## 0. Chuẩn bị và quy ước

### 0.1. Công cụ

Trên Windows, cài Docker Desktop, chọn **Linux containers**, khởi động Docker Desktop và chờ Engine sẵn sàng. Dùng PowerShell cho toàn bộ lệnh trong tài liệu. Docker Desktop chạy Linux containers qua môi trường Linux/VM; không có nghĩa chúng dùng trực tiếp Windows kernel.

Nếu bắt đầu từ máy trống: cài [Git](https://git-scm.com/downloads), [Python](https://www.python.org/downloads/), [Node.js](https://nodejs.org/en/download) và [PostgreSQL cho Windows](https://www.postgresql.org/download/windows/) từ nguồn chính thức. Khi cài PostgreSQL, chọn PostgreSQL Server và Command Line Tools, nhớ mật khẩu user quản trị `postgres` và cổng đã chọn. Nếu `psql` chưa có trong PATH, có thể mở bằng `& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h localhost -U postgres` hoặc thêm thư mục `bin` đó vào PATH rồi mở terminal mới. Kiểm tra đúng phiên bản trước khi tiếp tục; không giả định Python/Node đã có chỉ vì VS Code đã cài.

Để chạy baseline local cần Git, Python 3.12+, Node.js 22+, npm và PostgreSQL 17 cài trên máy. Sau phần 8, chạy ứng dụng chỉ cần Docker và source code. Các lệnh local Python/Node vẫn hữu ích cho phát triển.

```powershell
git --version
python --version
node --version
npm.cmd --version
docker version
docker compose version
docker run --rm hello-world
```

`docker version` phải có cả Client và Server. Chỉ thấy Client chưa chứng minh Engine hoạt động. Dùng cú pháp `docker compose`; tài liệu không phụ thuộc vào tên gọi phiên bản Compose v2 hay v5, nhưng cần hỗ trợ `up --wait`, profiles và healthcheck.

Tất cả lệnh bắt đầu ở thư mục gốc repository, trừ nơi có ghi `Set-Location`. Khi xuống dòng PowerShell, dấu backtick phải là ký tự cuối dòng, không có dấu cách sau nó.

### 0.2. Những gì phải thống nhất với code hiện tại

| Thành phần | Hợp đồng dùng xuyên suốt |
|---|---|
| Tạo/list URL | `POST /api/urls`, `GET /api/urls` |
| Redirect/xóa | `GET /api/urls/{short_code}`, `DELETE /api/urls/{short_code}` |
| Health hiện có | `GET /app/health` → `{"status":"healthy"}` |
| Thời hạn | `expires_at`, không phải `expired_at`; gửi ISO 8601 có múi giờ |
| Khóa chính | UUID, không phải `SERIAL` |
| Local backend | `http://localhost:8000` |
| Local frontend | `http://localhost:3000` |
| Frontend Docker | `http://localhost:8080` |
| PostgreSQL local | `localhost:5432` |
| PostgreSQL Docker mở ra host khi demo | `localhost:5433` để tránh đụng bản cài local |
| PostgreSQL giữa container | `seminar-pg:5432` khi chạy tay; `postgres:5432` trong Compose |
| Redis cuối bài | `redis:6379` trong Compose |

Baseline hiện tại đã có CRUD, redirect qua service, expiration, click count, phân trang và Redis fallback. Router khai báo `responses` cho OpenAPI, redirect trả 302; không cần viết lại endpoint để bắt đầu Docker. Backend tests dùng SQLite in-memory và Redis giả lập, không ghi vào PostgreSQL local.

Nhánh `feature/docker` bắt đầu từ baseline local. Các Dockerfile, `.dockerignore`, `nginx.conf`, `docker/postgres/init.sql` và `compose.yaml` sẽ được **tạo mới ở các phần tương ứng**; ví dụ trong tài liệu chưa đồng nghĩa các file đó đã có trong repository.

Không dùng SQLite làm baseline trong bài này: ứng dụng đang dùng UUID và PostgreSQL, nên đổi engine để né cài DB sẽ tạo thêm một bài toán ngoài Docker.

### 0.3. Kế hoạch tag và thời lượng

| Phần | Tag sau khi hoàn tất | Bằng chứng cần có | Gợi ý phút |
|---|---|---|---:|
| Chuẩn bị | `seminar/00-local` | App local + smoke test thành công | làm trước |
| 1 | `seminar/01-problem` | Lỗi thiếu môi trường được tái hiện | 4 |
| 2 | `seminar/02-concepts` | Phân biệt Dockerfile/image/container/VM | 5 |
| 3 | `seminar/03-image` | Backend image và container có log | 7 |
| 4 | `seminar/04-ports` | Host gọi được health qua cổng publish | 4 |
| 5 | `seminar/05-registry-db` | PostgreSQL container có bảng đúng | 5 |
| 6 | `seminar/06-network` | Backend container CRUD được DB container | 6 |
| 7 | `seminar/07-volume` | Tạo lại DB container vẫn còn dữ liệu | 6 |
| 8 | `seminar/08-compose` | Frontend/backend/PostgreSQL chạy cùng lúc | 8 |
| 9 | `seminar/09-redis` | MISS → HIT, invalidation, Redis failover | 8 |
| 10 | `seminar/10-architecture` | Kiểm thử trong container và CI | 5 |
| 11 | `seminar/11-final` | Checklist và sơ đồ kiến trúc hoàn chỉnh | 2 + Q&A |

Đây là khoảng 60 phút trình bày, chưa tính thời gian pull/build. Chuẩn bị image trước buổi seminar nhưng vẫn demo ít nhất một lần build/pull thật. Nếu chỉ có 30 phút, giảm số lần nhập lệnh và để CI/backup làm phần đọc thêm.

### 0.4. Git: lưu đúng tiến trình, giữ an toàn dữ liệu

Nhánh làm việc là `feature/docker`. Trước khi bắt đầu, xem `git status` và lưu các thay đổi đang làm. Với clone chưa có nhánh này, tạo bằng `git switch -c feature/docker` từ baseline local; nếu nhánh đã có, chạy:

```powershell
git status
git switch feature/docker
New-Item -ItemType Directory -Force docs | Out-Null
if (-not (Test-Path docs/seminar-checkpoints.md)) {
    Set-Content -Encoding utf8 docs/seminar-checkpoints.md '# Nhật ký checkpoint Docker'
}
```

Phần environment trong `.gitignore` hiện đã có các quy tắc sau; giữ nguyên để cấu hình riêng không vào Git:

```gitignore
.env
.env.*
!.env.example
!.env.*.example
```

Giữ những mục ignore Python/Node đã có. `.dockerignore` khác `.gitignore`: một file không lên Git vẫn có thể lọt vào build context nếu không được loại khỏi context.

Mỗi checkpoint: sửa file → chạy test → ghi lại kết quả vào `docs/seminar-checkpoints.md` → `git add` đúng các file đã sửa → commit → annotated tag. Các phần chỉ có lý thuyết vẫn có commit nhật ký riêng. Không force tag, không commit `.env`, không tự động `git add .` khi thư mục có việc khác.

Script `scripts/switch-tag.ps1` dùng cùng danh sách 12 tag trong bảng trên. Commit script trước khi đổi checkpoint để working tree sạch:

```powershell
.\scripts\switch-tag.ps1
.\scripts\switch-tag.ps1 -Tag seminar/00-local
git switch -
```

Menu hiển thị tag đã có/chưa tạo. Tag chưa tồn tại báo đúng `git tag not found`; script không tự tạo/fetch tag. Script chuyển sang detached HEAD và từ chối nếu còn thay đổi chưa commit/stash. `git switch -` quay lại nhánh trước. Tag tạo trước khi script được commit sẽ chưa có file script; khi đó dùng Git trực tiếp để quay lại nhánh.

Ví dụ xem lại phần 8 bằng một thư mục khác, sau khi đã có tag:

```powershell
git worktree add ../url-shortener-p08 seminar/08-compose
```

Git tag lưu source, **không lưu image, container, biến môi trường hay dữ liệu volume**. Worktree mới phải tạo lại `.env`; các worktree dùng chung Docker Engine nên chỉ chạy một sân khấu seminar tại một thời điểm. Không dùng `git reset --hard` để đổi sân khấu.

### 0.5. Chuẩn bị baseline PostgreSQL trên máy

Mở `psql -h localhost -U postgres`, nhập tài khoản quản trị của PostgreSQL local. Trên một database mới, chạy:

```sql
CREATE USER shortener_user WITH PASSWORD 'shortener_password';
CREATE DATABASE url_shortener OWNER shortener_user;
```

Nếu user/database đã tồn tại, kiểm tra lại thay vì chạy lại câu `CREATE`. Tài khoản/mật khẩu trong tài liệu chỉ là thông tin demo local. Đây là bước provisioning, không tự chuyển dữ liệu từ database cũ sang database mới.

Tạo môi trường Python:

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Set-Location ..
```

Chỉnh `backend/.env`:

```dotenv
DATABASE_URL=postgresql+psycopg://shortener_user:shortener_password@localhost:5432/url_shortener
REDIS_URL=
BASE_URL=http://localhost:8000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
CACHE_TTL_SECONDS=3600
```

Cấu hình hiện tại đọc `backend/.env`; biến môi trường của process được ưu tiên hơn file. `cache_ttl_seconds` đã là số nguyên không âm (mặc định 3600, 0 tắt ghi cache), CORS dùng `settings.cors_origin_list`. Giữ nguyên các cấu hình ứng dụng này khi đóng gói.

Module `backend/app/db/init_db.py` dùng lại cho local và container; nếu checkout baseline chưa có module, tạo với nội dung:

```python
from app.db.database import Base, engine
from app.db import models  # Đăng ký model vào metadata trước create_all.

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    print("Database schema ready")
```

Chạy từ gốc repository:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m app.db.init_db
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

`create_all` tạo bảng còn thiếu, không migration cột đã tồn tại. Nếu đang có bảng `SERIAL`/`expired_at`, dùng database demo mới cho bài học hoặc viết migration riêng; không xóa dữ liệu thật để chữa lỗi schema.

Terminal khác:

```powershell
Set-Location frontend
npm.cmd ci --ignore-scripts
npm.cmd run dev
```

`frontend/.env.development` cần `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`. Truy cập `http://localhost:3000`, tạo link, bấm Go, Refresh, Reset và kiểm tra link redirect. Sau một lần tạo, Shorten/Expand chỉ đổi cách hiển thị cho đến khi Reset.

### 0.6. Dependencies và kiểm thử baseline

Các file `backend/requirements.in` và `backend/requirements-dev.in` khai báo phiên bản trực tiếp chính xác. Hai file `.txt` khóa cả phiên bản gián tiếp và SHA256. Dùng dev lock cho phát triển/CI unit tests; image runtime chỉ cài runtime lock.

Chỉ khi chủ động nâng phiên bản, sửa file `.in`, rồi từ root tạo lại cả hai lock bằng uv 0.13.6:

```powershell
uv pip compile backend/requirements.in --universal --python-version 3.12 --generate-hashes --output-file backend/requirements.txt
uv pip compile backend/requirements-dev.in --constraint backend/requirements.txt --universal --python-version 3.12 --generate-hashes --output-file backend/requirements-dev.txt
```

Không cần uv để cài app từ lock đã có. Commit cả input và output khi nâng dependency. Pip local, CI và Dockerfile đều dùng `--require-hashes --only-binary=:all:` để kiểm tra hash và chỉ cài wheel.

Frontend đã pin phiên bản trong `package.json`; `package-lock.json` lưu phiên bản resolved và integrity. Dùng `npm.cmd ci --ignore-scripts`. Để chạy browser tests local, từ root:

```powershell
Push-Location frontend
try {
    node --test tests/api.test.mjs
    npm.cmd exec --no -- playwright install chromium
    node -e "const r=require('node:child_process').spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{stdio:'inherit',env:{...process.env,NEXT_PUBLIC_API_BASE_URL:''}});process.exit(r.status??1)"
    npm.cmd run test:e2e
} finally {
    Pop-Location
}
```

Node truyền rõ API base rỗng khi build, kể cả trên Windows PowerShell có thể xóa biến khi gán chuỗi rỗng. Playwright tự chạy static server ở port 8080 và intercept API; dừng server/container khác đang dùng cổng đó trước khi test. CI gọi thẳng binary Playwright sau `npm ci`, không để `npx` tự tải package khi thiếu. Thư viện hệ thống do `--with-deps` cài từ OS repository không thuộc Python/npm lock.

### 0.7. Tạo smoke test HTTP dùng lại ở mọi giai đoạn

Tạo `backend/tests/smoke_api.py`. Đây là test tích hợp **gửi HTTP thật**; nó tạo các bản ghi của riêng mình rồi xóa chúng. Chỉ chạy trên hệ thống demo/test. Script không follow redirect, vì cần kiểm tra mã 302 và header Location thay vì truy cập website bên ngoài.

```python
import json
import os
import time
import unittest
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


BASE = os.environ.get("SMOKE_BASE_URL", "http://localhost:8000").rstrip("/")
HTTP = build_opener(NoRedirect)


def request(method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(BASE + path, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        response = HTTP.open(req, timeout=10)
    except HTTPError as exc:
        response = exc  # 302/404/410 vẫn là kết quả HTTP cần assert.
    with response:
        return response.code, response.headers, response.read()


class UrlSmokeTests(unittest.TestCase):
    def setUp(self):
        self.codes = []

    def tearDown(self):
        for code in self.codes:
            request("DELETE", f"/api/urls/{code}")

    def create(self, seconds=3600):
        expiry = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        status, _, body = request("POST", "/api/urls", {
            "original_url": "https://example.com/docker-seminar",
            "expires_at": expiry.isoformat(),
        })
        self.assertEqual(status, 201, body)
        url = json.loads(body)
        self.codes.append(url["short_code"])
        return url["short_code"]

    def test_crud_redirect_and_clicks(self):
        code = self.create()
        status, headers, _ = request("GET", f"/api/urls/{code}")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "https://example.com/docker-seminar")
        status, _, body = request("GET", "/api/urls")
        self.assertEqual(status, 200)
        item = next(item for item in json.loads(body) if item["short_code"] == code)
        self.assertEqual(item["click_count"], 1)
        self.assertEqual(request("DELETE", f"/api/urls/{code}")[0], 204)
        self.assertEqual(request("GET", f"/api/urls/{code}")[0], 404)
        self.codes.remove(code)

    def test_expiration(self):
        code = self.create(seconds=3)
        time.sleep(4)
        self.assertEqual(request("GET", f"/api/urls/{code}")[0], 410)


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

Từ gốc repository, khi backend đang chạy:

```powershell
backend/.venv/Scripts/python.exe backend/tests/smoke_api.py
```

Kỳ vọng: **2 tests OK**. Health riêng:

```powershell
Invoke-RestMethod http://localhost:8000/app/health
```

Chạy thêm bộ test sẵn có từ thư mục `backend`: `.\.venv\Scripts\python.exe -m pytest -q`. Test suite đã kiểm tra health, validation, CRUD, redirect, cache, TTL và rollback bằng DB test in-memory. Smoke test ở trên bổ sung bằng chứng kết nối PostgreSQL/HTTP thật; không thay thế unit tests.

Lưu checkpoint baseline. Stage thêm các file ứng dụng local đã sửa của bạn nếu chúng chưa được commit:

```powershell
Add-Content docs/seminar-checkpoints.md '00: Local CRUD, redirect, expiration: 2 smoke tests passed.'
git add docker_integration.md docs/IMPLEMENTATION_GUIDE.md docs/seminar-checkpoints.md scripts/switch-tag.ps1 backend/app/db/init_db.py backend/tests/smoke_api.py
git diff --cached --stat
git commit -m "seminar: establish working local baseline and smoke tests"
git tag -a seminar/00-local -m "Local application verified before Docker"
```

## 1. Mở đầu: It works on my machine

**Mục tiêu:** cho người nghe thấy app làm được gì trước khi nói Docker.

Demo tạo URL ở `localhost:3000`, chọn thời hạn, bấm Go để thấy chuyển hướng. Trình bày luồng: browser → API → PostgreSQL; khi bấm link, API trả 302 cho browser.

Tạo một Python environment trống tách khỏi environment đang chạy. Thực hiện trong terminal khác, không thay môi trường của app chính:

```powershell
python -m venv backend/.venv-empty
Push-Location backend
.\.venv-empty\Scripts\python.exe -m uvicorn app.main:app
Pop-Location
```

Kỳ vọng: `No module named uvicorn`. Không cần uninstall package của máy thật. Thêm `.venv-empty/` vào `.gitignore`.

Lời dẫn: “Source code giống nhau nhưng máy mới thiếu runtime, thư viện, biến môi trường và database. Chúng ta cần mô tả môi trường chạy cùng với ứng dụng.” Docker giúp đóng gói phần môi trường, nhưng vẫn cần cấu hình đúng secret, network và dữ liệu.

Ghi lỗi/kết quả demo vào nhật ký rồi tag:

```powershell
Add-Content docs/seminar-checkpoints.md '01: Empty Python environment reproduces missing uvicorn.'
git add .gitignore docs/seminar-checkpoints.md
git commit -m "seminar: reproduce works-on-my-machine failure"
git tag -a seminar/01-problem -m "Problem demonstrated without breaking working local setup"
```

## 2. Tổng quan Docker và containerization

**Containerization:** đóng gói ứng dụng và userspace dependencies thành image; chạy image với process isolation thành container. [Docker overview](https://docs.docker.com/get-started/docker-overview/)

| Khái niệm | Liên hệ trong bài |
|---|---|
| Dockerfile | Công thức cài Python dependencies, copy backend và khai báo lệnh chạy |
| Image | Artifact gồm các layer; có thể tạo nhiều container từ một image |
| Container | Một lần chạy image, có process, network và writable layer riêng |
| Registry | Nơi phân phối image; Docker Hub là một registry |
| Volume | Nơi giữ dữ liệu độc lập với vòng đời container |
| Compose | Khai báo và quản lý các service của ứng dụng |

| | Container | Virtual Machine |
|---|---|---|
| Cách cô lập chính | Process, filesystem, network; dùng chung kernel môi trường Linux chủ | Máy ảo có guest OS/kernel riêng |
| Đóng gói | App + dependencies cần chạy | OS + app + dependencies |
| Khởi động/tài nguyên | Thường nhẹ hơn | Thường cần nhiều tài nguyên hơn |
| Lưu ý | Không phải ranh giới bảo mật tuyệt đối hay giải pháp cho mọi khác biệt phần cứng | Cô lập cả môi trường OS rộng hơn |

Không nói “Docker chạy được mọi nơi bất kể OS/CPU”: image phải tương thích nền tảng hoặc có build đa nền tảng/emulation. [Multi-platform builds](https://docs.docker.com/build/building/multi-platform/)

Demo quan sát image/container nhỏ:

```powershell
docker image ls
docker run --name seminar-concepts alpine:3.22 echo "Hello from a container"
docker ps
docker ps -a --filter name=seminar-concepts
docker logs seminar-concepts
docker rm seminar-concepts
```

Container thoát sau khi `echo` kết thúc: container không nhất thiết là một máy chủ chạy mãi. `docker ps` chỉ hiện container đang chạy; `ps -a` hiện cả container đã thoát.

```powershell
Add-Content docs/seminar-checkpoints.md '02: Image vs container, process lifecycle, container vs VM explained.'
git add docs/seminar-checkpoints.md
git commit -m "seminar: document container concepts and lifecycle observation"
git tag -a seminar/02-concepts -m "Docker concepts and exited container demo"
```

## 3. Docker hóa backend

**Mục tiêu:** đóng gói backend trước; PostgreSQL vẫn ở host để người học không phải hiểu tất cả một lúc.

Tạo `backend/.dockerignore`:

```dockerignore
.venv*
__pycache__
*.py[cod]
.pytest_cache
.env*
.git
```

Tạo `backend/Dockerfile` với bản đầu tiên:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Giải thích từng dòng: `FROM` chọn nền; `WORKDIR` chọn thư mục; `COPY requirements` trước source giúp cache cài dependencies; `RUN` chạy khi build; `CMD` chạy khi container bắt đầu; `EXPOSE` mô tả cổng chứ chưa mở cổng host. [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)

Từ root:

```powershell
docker build -t url-shortener-backend:p03 ./backend
docker image ls url-shortener-backend
```

Tạo `backend/.env.docker` **không commit**:

```dotenv
DATABASE_URL=postgresql+psycopg://shortener_user:shortener_password@host.docker.internal:5432/url_shortener
REDIS_URL=
BASE_URL=http://localhost:8001
CORS_ORIGINS=http://localhost:3000
CACHE_TTL_SECONDS=3600
```

`host.docker.internal` ở Docker Desktop trỏ đến host từ container. PostgreSQL local phải cho phép kết nối phù hợp từ Docker; không mở PostgreSQL ra Internet chỉ để demo. Với Linux Engine thuần, có thể cần `--add-host host.docker.internal:host-gateway`. Phần 6 sẽ loại phụ thuộc database trên host.

```powershell
docker run -d --name seminar-backend-p03 --env-file backend/.env.docker url-shortener-backend:p03
docker logs seminar-backend-p03
docker inspect seminar-backend-p03 --format '{{.State.Status}}'
docker stop seminar-backend-p03
docker start seminar-backend-p03
docker logs --tail 20 seminar-backend-p03
```

Kỳ vọng log Uvicorn khởi động. Vì SQLAlchemy kết nối lazy, “Application startup complete” **chưa chứng minh DB kết nối thành công**. Không dùng mỗi health endpoint để khẳng định CRUD chạy.

Sửa một dòng thông báo trong app rồi build lại để thấy layer cài dependencies được cache; image cũ/container cũ không tự thay đổi. Muốn chạy source mới phải build và tạo lại container.

```powershell
Add-Content docs/seminar-checkpoints.md '03: Backend image built; container start/stop/logs verified; DB not yet guaranteed.'
git add backend/Dockerfile backend/.dockerignore docs/seminar-checkpoints.md
git commit -m "seminar: package backend as Docker image"
git tag -a seminar/03-image -m "Backend image and basic lifecycle"
```

## 4. Port mapping

**Tạo vấn đề:** container p03 đang chạy nhưng không có publish port. `curl.exe --max-time 3 http://localhost:8001/app/health` không vào được container đó.

```powershell
docker port seminar-backend-p03
```

Không có output là đúng cho container chưa publish. Không dùng `localhost:8000` cho demo lỗi nếu backend local vẫn chạy ở đó: bạn sẽ nhìn nhầm server local.

Tạo lại với mapping:

```powershell
docker stop seminar-backend-p03
docker rm seminar-backend-p03
docker run -d --name seminar-backend-p04 --env-file backend/.env.docker -p 127.0.0.1:8001:8000 url-shortener-backend:p03
docker port seminar-backend-p04
Invoke-RestMethod http://localhost:8001/app/health
```

`127.0.0.1:8001:8000` = bind trên loopback host, host port 8001, container port 8000. Uvicorn phải bind `0.0.0.0` **bên trong container**, không phải `127.0.0.1`. Có thể nhiều container cùng dùng container port 8000 nhưng publish ra các host port khác nhau. [Port publishing](https://docs.docker.com/engine/network/port-publishing/)

Kiểm tra kết nối database thật:

```powershell
$env:SMOKE_BASE_URL = 'http://localhost:8001'
backend/.venv/Scripts/python.exe backend/tests/smoke_api.py
Remove-Item Env:SMOKE_BASE_URL
```

Nếu health pass mà smoke fail vì PostgreSQL host không chấp nhận kết nối Docker, ghi nhận rõ giới hạn; xử lý cấu hình PostgreSQL local hoặc tiếp tục qua phần 5–6. Checkpoint p04 chỉ yêu cầu mapping/health đúng; p06 mới bắt buộc smoke thành công hoàn toàn trong network Docker.

```powershell
Add-Content docs/seminar-checkpoints.md '04: Host 8001 maps to container 8000; health reachable; record actual DB smoke outcome.'
git add docs/seminar-checkpoints.md
git commit -m "seminar: demonstrate port publishing"
git tag -a seminar/04-ports -m "Container is reachable through published port"
```

## 5. Registry và PostgreSQL container

**Lời dẫn:** backend đã được đóng gói, nhưng máy khác vẫn phải cài PostgreSQL. Thay vì tự viết image PostgreSQL, lấy image do cộng đồng PostgreSQL duy trì từ registry.

```powershell
docker pull postgres:17-alpine
docker image inspect postgres:17-alpine --format '{{json .RepoDigests}}'
```

`postgres` là repository, `17-alpine` là tag. Registry mặc định của tên này là Docker Hub. Tag có thể trỏ tới image mới sau một lần phát hành; digest định danh nội dung cụ thể. Chọn PostgreSQL 17 xuyên suốt bài vì mount data directory dưới đây dành cho phiên bản này; không đổi sang `latest` giữa chừng. PostgreSQL 18+ có thay đổi bố trí data/volume, phải đọc hướng dẫn image trước khi nâng cấp. [Official PostgreSQL image](https://hub.docker.com/_/postgres)

### 5.1. SQL phải khớp UUID và expires_at

Tạo thư mục `docker/postgres`, rồi tạo `docker/postgres/init.sql`:

```powershell
New-Item -ItemType Directory -Force docker/postgres | Out-Null
```

```sql
CREATE TABLE IF NOT EXISTS urls (
    id UUID PRIMARY KEY,
    short_code VARCHAR(32) NOT NULL UNIQUE,
    original_url VARCHAR(2048) NOT NULL,
    click_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
```

UUID được ứng dụng sinh bằng `uuid.uuid4`; không cần cài extension để chạy schema này. Các lệnh SQL insert bằng tay trong bài sẽ truyền UUID cụ thể. SQL bootstrap này tương ứng với model UUID và `expires_at` hiện tại.

### 5.2. Khởi tạo container database

```powershell
$initSql = (Resolve-Path docker/postgres/init.sql).Path
docker run -d --name seminar-pg `
  -e POSTGRES_USER=shortener_user `
  -e POSTGRES_PASSWORD=shortener_password `
  -e POSTGRES_DB=url_shortener `
  -p 127.0.0.1:5433:5432 `
  --mount "type=bind,source=$initSql,target=/docker-entrypoint-initdb.d/001-init.sql,readonly" `
  postgres:17-alpine
```

Thêm một hàm chờ để không chạy SQL trước lúc DB sẵn sàng. Chạy định nghĩa này một lần trong terminal đang demo:

```powershell
function Wait-Pg([string]$Container) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $Container pg_isready -h 127.0.0.1 -U shortener_user -d url_shortener *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw "PostgreSQL not ready: $Container. Inspect docker logs."
}
Wait-Pg seminar-pg
docker logs --tail 30 seminar-pg
docker exec seminar-pg psql -U shortener_user -d url_shortener -c '\d urls'
```

Kỳ vọng thấy `uuid`, `expires_at`, `timestamp with time zone`. Từ máy host, công cụ database kết nối `localhost:5433`, không phải cổng 5432 của bản cài local.

Image PostgreSQL có khai báo volume; ở bước này Docker có thể tạo **anonymous volume** dù bạn chưa đặt tên volume. Vì thế không nói “không có `-v` thì chắc chắn mọi dữ liệu nằm trong writable layer”. Phần 7 sẽ chỉ rõ khác biệt.

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` và các file `/docker-entrypoint-initdb.d` chỉ khởi tạo khi data directory trống. Sửa env hoặc init.sql không tự thay mật khẩu/schema của volume đã có dữ liệu.

### 5.3. Tag source và image là hai việc khác nhau

```powershell
Add-Content docs/seminar-checkpoints.md '05: Pulled PostgreSQL image; UUID/expires_at schema verified in DB container.'
git add docker/postgres/init.sql docs/seminar-checkpoints.md
git commit -m "seminar: provision PostgreSQL from registry image"
git tag -a seminar/05-registry-db -m "Registry pull and PostgreSQL container verified"
```

Đẩy image ứng dụng lên registry là bài mở rộng, chỉ làm sau khi có tài khoản/repository của bạn. Thay `YOUR_DOCKERHUB_USER` trước khi chạy:

```powershell
docker login
docker tag url-shortener-backend:p03 YOUR_DOCKERHUB_USER/url-shortener-backend:p03
docker push YOUR_DOCKERHUB_USER/url-shortener-backend:p03
```

Git tag đánh dấu source commit. Image tag đặt tên một image để chạy/phân phối. Không tự động push image/source khi mới học xong một checkpoint; kiểm tra nội dung trước khi publish.

## 6. Docker Network

**Đặt vấn đề:** hai container có `localhost` riêng. Backend không tìm thấy PostgreSQL nếu `DATABASE_URL` trỏ tới `localhost:5432` bên trong chính backend.

```powershell
docker network create seminar-net
docker network connect seminar-net seminar-pg
```

Sửa **file riêng** `backend/.env.docker`:

```dotenv
DATABASE_URL=postgresql+psycopg://shortener_user:shortener_password@seminar-pg:5432/url_shortener
REDIS_URL=
BASE_URL=http://localhost:8001
CORS_ORIGINS=http://localhost:3000
CACHE_TTL_SECONDS=3600
```

Demo sai host bằng một container chạy lệnh ngắn, không sửa container đang phục vụ:

```powershell
docker run --rm --network seminar-net --env-file backend/.env.docker `
  -e DATABASE_URL=postgresql+psycopg://shortener_user:shortener_password@localhost:5432/url_shortener `
  url-shortener-backend:p03 python -c "from app.db.database import engine; engine.connect()"
```

Kỳ vọng lỗi kết nối; đây là lỗi có chủ đích. Chạy lại bỏ `-e DATABASE_URL=...` để dùng hostname đúng:

```powershell
docker run --rm --network seminar-net --env-file backend/.env.docker url-shortener-backend:p03 python -c "from app.db.database import engine; engine.connect(); print('Connected')"
```

Thay container p04 bằng container nối network:

```powershell
docker stop seminar-backend-p04
docker rm seminar-backend-p04
docker run -d --name seminar-backend --network seminar-net --env-file backend/.env.docker -p 127.0.0.1:8001:8000 url-shortener-backend:p03
docker exec seminar-backend python -c "import socket; print(socket.gethostbyname('seminar-pg'))"
docker network inspect seminar-net
$env:SMOKE_BASE_URL = 'http://localhost:8001'
backend/.venv/Scripts/python.exe backend/tests/smoke_api.py
Remove-Item Env:SMOKE_BASE_URL
```

**Checkpoint bắt buộc:** 2 smoke tests pass, không chỉ health. Lệnh DNS có thể in IP khác khi tạo lại container; đó là lý do dùng tên thay vì hardcode IP. User-defined bridge cung cấp phân giải tên giữa các container trên network đó. Container gọi container dùng **container port 5432**, không dùng host port 5433. [Bridge networking](https://docs.docker.com/engine/network/drivers/bridge/)

Nếu dùng frontend local để demo cùng backend Docker, tạm sửa `frontend/.env.development` sang `http://localhost:8001` rồi khởi động lại Next dev. Sang phần 8 sẽ dùng frontend container/same origin.

```powershell
Add-Content docs/seminar-checkpoints.md '06: Container DNS and PostgreSQL connectivity verified; HTTP smoke tests pass.'
git add docs/seminar-checkpoints.md
git commit -m "seminar: connect backend and database on a user-defined network"
git tag -a seminar/06-network -m "Manual multi-container networking works"
```

## 7. Docker Volume

### 7.1. Tạo dữ liệu demo, rồi cố ý bỏ container/data demo

Chỉ dùng container `seminar-pg` do bài học tạo; không thay tên bằng PostgreSQL đang chứa dữ liệu thật.

```powershell
docker exec seminar-pg psql -U shortener_user -d url_shortener -c "INSERT INTO urls (id,short_code,original_url,expires_at) VALUES ('11111111-1111-4111-8111-111111111111','volume-demo','https://example.com',NOW()+INTERVAL '1 day');"
docker exec seminar-pg psql -U shortener_user -d url_shortener -c "SELECT short_code FROM urls;"
docker inspect seminar-pg --format '{{json .Mounts}}'
```

Quan sát anonymous volume ở data directory và bind mount của init.sql. Dừng backend trước khi thay database:

```powershell
docker stop seminar-backend
docker stop seminar-pg
docker rm -v seminar-pg
```

`rm -v` ở đây **cố ý xóa anonymous data volume của container demo này**; bind-mounted init.sql vẫn còn. Nếu chỉ `docker rm`, anonymous volume thường còn nhưng container mới không tự gắn lại volume cũ, nên người dùng vẫn thấy database trống. Không đánh đồng “container mới không thấy dữ liệu” với “mọi byte dữ liệu trên host đã bị xóa”. [Volume lifecycle](https://docs.docker.com/engine/storage/volumes/)

Chạy lại lệnh `docker run --name seminar-pg ...` ở phần 5, chờ `Wait-Pg seminar-pg`, truy vấn `SELECT short_code FROM urls;`: không còn `volume-demo`. Đây là dữ liệu demo được phép bỏ.

### 7.2. Dùng named volume và chứng minh dữ liệu tồn tại

```powershell
docker stop seminar-pg
docker rm -v seminar-pg
docker volume create seminar-pg-data
$initSql = (Resolve-Path docker/postgres/init.sql).Path
docker run -d --name seminar-pg --network seminar-net `
  -e POSTGRES_USER=shortener_user `
  -e POSTGRES_PASSWORD=shortener_password `
  -e POSTGRES_DB=url_shortener `
  -p 127.0.0.1:5433:5432 `
  --mount type=volume,source=seminar-pg-data,target=/var/lib/postgresql/data `
  --mount "type=bind,source=$initSql,target=/docker-entrypoint-initdb.d/001-init.sql,readonly" `
  postgres:17-alpine
Wait-Pg seminar-pg
docker exec seminar-pg psql -U shortener_user -d url_shortener -c "INSERT INTO urls (id,short_code,original_url,expires_at) VALUES ('22222222-2222-4222-8222-222222222222','persistent-demo','https://example.com',NOW()+INTERVAL '1 day');"
docker stop seminar-pg
docker rm seminar-pg
```

**Chạy lại đúng lệnh `docker run` ở trên với cùng `source=seminar-pg-data`**, rồi:

```powershell
Wait-Pg seminar-pg
docker exec seminar-pg psql -U shortener_user -d url_shortener -c "SELECT short_code FROM urls WHERE short_code='persistent-demo';"
docker start seminar-backend
docker volume inspect seminar-pg-data
```

Kỳ vọng vẫn có `persistent-demo`. Không chạy lại INSERT sau mỗi lần tạo container vì primary key/short code đã tồn tại. Init SQL không chạy lại trên volume đã khởi tạo.

| Cơ chế | Trong bài |
|---|---|
| Writable layer | File tạo trong filesystem container, mất cùng container |
| Anonymous volume | Docker đặt tên ngẫu nhiên; phải biết cách gắn lại để dùng dữ liệu cũ |
| Named volume | `seminar-pg-data`, gắn lại bằng tên khi tạo container mới |
| Bind mount | init.sql trên host được mount read-only vào container |

Named volume không tự đi theo image sang máy khác, và không thay thế backup. Ví dụ backup DB demo không qua toán tử redirect có thể đổi encoding trên PowerShell:

```powershell
docker exec seminar-pg pg_dump -U shortener_user -d url_shortener -f /tmp/seminar.sql
docker cp seminar-pg:/tmp/seminar.sql ./seminar-backup.sql
```

Không commit dump có dữ liệu thật. Bổ sung `seminar-backup.sql` vào `.gitignore` nếu sử dụng lệnh này.

```powershell
Add-Content docs/seminar-checkpoints.md '07: Anonymous volume loss demo isolated; named volume survives DB container recreation.'
git add .gitignore docs/seminar-checkpoints.md
git commit -m "seminar: demonstrate persistent PostgreSQL data using volumes"
git tag -a seminar/07-volume -m "Named volume persistence verified"
```

## 8. Docker Compose và frontend container

**Đặt vấn đề:** phải nhớ nhiều lệnh `run`, env, network, volume và thứ tự chờ. Compose mô tả tất cả bằng YAML để chạy lặp lại.

### 8.1. Chuẩn bị backend image có runtime và test target

Thay `backend/Dockerfile` bằng:

```dockerfile
FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.txt
COPY app ./app

FROM base AS test
COPY tests ./tests
CMD ["python", "tests/smoke_api.py"]

FROM base AS runtime
RUN useradd --create-home --uid 10001 appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Runtime là stage cuối nên `docker build ./backend` mặc định chọn nó. Test target chỉ cần stdlib smoke script và không tự import app/đụng DB khi chạy; test sẽ gọi backend qua HTTP. Backend runtime chạy non-root; PostgreSQL lưu dữ liệu ở container riêng.

### 8.2. Frontend: build Next.js, serve bằng Nginx

`frontend/next.config.mjs` đã có `output: 'export'`; giữ nguyên. Không dùng `next start` cho output tĩnh này.

Tạo `frontend/.dockerignore`:

```dockerignore
node_modules
.next
out
.git
.env*
test-results
playwright-report
```

Tạo `frontend/Dockerfile`:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_PUBLIC_API_BASE_URL=""
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html
USER 101:101
EXPOSE 8080
```

Đây là multi-stage build: image chạy chỉ cần Nginx và static assets, không cần Node/npm. Các tag major/stable trong tài liệu ưu tiên dễ làm theo; sau buổi học, khóa phiên bản/digest được kiểm thử để tái lập chính xác hơn. [Multi-stage build guidance](https://docs.docker.com/build/building/multi-stage/)

`NEXT_PUBLIC_API_BASE_URL` để rỗng **khi build**: trình duyệt gọi `/api/urls` trên cùng origin Nginx. Không đưa `http://backend:8000` vào JS vì browser trên máy người dùng không phân giải được hostname nội bộ Docker. `NEXT_PUBLIC_*` được đóng vào bundle lúc build; đặt lại env khi chạy Nginx không sửa bundle đã build. [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables)

Tạo `frontend/nginx.conf`:

```nginx
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    resolver 127.0.0.11 valid=10s;
    set $backend http://backend:8000;

    location /api/ {
        proxy_pass $backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /app/health {
        proxy_pass $backend;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Giữ nguyên URI `/api/urls/{short_code}` khi proxy, không thêm dấu `/` vào cuối giá trị `$backend` để cắt prefix. Resolver là DNS nội bộ Docker cho hostname backend. Route static không có fallback sang redirect `/{code}` vì ứng dụng đã đổi redirect sang `/api/urls/{code}`.

### 8.3. Tạo compose.yaml ba service

Tạo `compose.yaml` ở root với nội dung:

```yaml
name: url-shortener-seminar

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-shortener_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-shortener_password}
      POSTGRES_DB: ${POSTGRES_DB:-url_shortener}
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/001-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 10s
    networks: [data]

  backend:
    image: url-shortener-backend:seminar
    build:
      context: ./backend
      target: runtime
    environment:
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-shortener_user}:${POSTGRES_PASSWORD:-shortener_password}@postgres:5432/${POSTGRES_DB:-url_shortener}
      REDIS_URL: ""
      CACHE_TTL_SECONDS: "3600"
      BASE_URL: http://localhost:8080
      CORS_ORIGINS: http://localhost:8080
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/app/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s
    networks: [edge, data]

  frontend:
    image: url-shortener-frontend:seminar
    build: ./frontend
    ports: ["127.0.0.1:8080:8080"]
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
      interval: 5s
      timeout: 3s
      retries: 12
    networks: [edge]

  tests:
    profiles: [test]
    build:
      context: ./backend
      target: test
    environment:
      SMOKE_BASE_URL: http://backend:8000
    depends_on:
      backend:
        condition: service_healthy
    networks: [edge]

volumes:
  pg_data:

networks:
  edge:
  data:
    internal: true
```

Service `tests` là container tạm để kiểm thử, không phải service thứ tư luôn chạy. Ở phần 8 chỉ có ba service ứng dụng; đến phần 9 mới có Redis.

Root `.env.example` cho Compose, không phải file backend:

```dotenv
POSTGRES_USER=shortener_user
POSTGRES_PASSWORD=shortener_password
POSTGRES_DB=url_shortener
```

Nếu chưa có root `.env`, copy từ `.env.example`; nếu đã có, chỉ bổ sung/chỉnh ba key trên, không ghi đè các cấu hình riêng khác. Mật khẩu mẫu không chứa ký tự cần URL-encode; mật khẩu thật có `@`, `:`, `/`, `%` cần được encode đúng khi ghép database URL hoặc dùng cơ chế dựng URL khác.

Root `.env` phục vụ **Compose interpolation**, không tự trở thành env của mọi container. `environment` của service mới truyền giá trị vào backend. `backend/.env` chỉ dùng khi chạy local và không copy vào image. Các biến cùng tên ở terminal có thể được ưu tiên hơn `.env`; kiểm tra `$env:POSTGRES_USER` nếu cấu hình không như mong đợi. [Compose interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)

### 8.4. Chạy, test và giải thích thứ tự

Dừng container backend chạy tay để tránh nhầm log; giữ DB/volume thủ công làm bằng chứng phần 7, không cần xóa:

```powershell
docker stop seminar-backend seminar-pg
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail 30 backend postgres
docker compose --profile test run --build --rm tests
```

Kỳ vọng test container trả exit code 0 và 2 tests OK. Mở `http://localhost:8080`; tạo URL, Go, Reset, Refresh. Link rút gọn phải bắt đầu `http://localhost:8080/api/urls/`, không phải `backend:8000` hoặc đường dẫn cũ `/{code}`.

```powershell
docker compose exec backend python -c "import socket; print(socket.gethostbyname('postgres'))"
docker compose exec postgres psql -U shortener_user -d url_shortener -c '\d urls'
Invoke-RestMethod http://localhost:8080/app/health
```

Với tên user/database khác trong root `.env`, sửa các lệnh `psql -U/-d` tương ứng. Data volume Compose mới là `url-shortener-seminar_pg_data`; **không tự chứa dữ liệu** từ `seminar-pg-data` hoặc PostgreSQL local. Muốn chuyển dữ liệu phải dump/restore có chủ đích.

`depends_on` cơ bản chỉ sắp thứ tự start; `condition: service_healthy` mới đợi healthcheck. Nó không đảm bảo phụ thuộc sẽ luôn khỏe và không tự sửa lỗi ứng dụng khi DB hỏng về sau. [Startup order](https://docs.docker.com/compose/how-tos/startup-order/)

Backend health hiện tại chỉ là **liveness HTTP**; PostgreSQL có healthcheck riêng; smoke test mới xác minh CRUD, expiration và redirect. `docker compose config` chỉ kiểm tra cấu hình, không kiểm tra kết nối DB.

```powershell
Add-Content docs/seminar-checkpoints.md '08: Three application services boot with Compose; HTTP smoke tests and browser flow pass.'
git add compose.yaml .env.example backend/Dockerfile frontend/Dockerfile frontend/.dockerignore frontend/nginx.conf docs/seminar-checkpoints.md
git commit -m "seminar: orchestrate frontend backend and PostgreSQL using Compose"
git tag -a seminar/08-compose -m "Three-service application runs from Compose"
```

## 9. Mở rộng với Redis

**Đặt vấn đề:** cùng short code bị đọc nhiều lần. Dùng Redis lưu ánh xạ `short_code → original_url` để tránh đọc lại destination từ PostgreSQL cho mọi request.

### 9.1. Hiểu cache-aside trước khi chạy

```mermaid
flowchart TD
    A[GET /api/urls/code] --> B{Redis có key?}
    B -- Không: MISS --> C[UPDATE chưa hết hạn, tăng click và RETURNING mapping]
    C --> D{Tồn tại và chưa hết hạn?}
    D -- Không --> E[404 hoặc 410]
    D -- Có --> F[Lưu Redis với TTL]
    B -- Có: HIT --> G[SQL UPDATE click nếu link còn hiệu lực]
    G --> H{UPDATE được một hàng?}
    H -- Có --> I[302 với destination từ Redis]
    H -- Không --> J[Xóa key cũ rồi kiểm tra DB]
    J --> C
    F --> I
```

Đây là cache-aside với TTL: DB là nguồn dữ liệu chính; cache có thể xóa và dựng lại. [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/)

**Giới hạn của implementation này:** HIT vẫn chạy SQL `UPDATE` để đếm click và kiểm tra link còn hiệu lực. Không nói “cache hit hoàn toàn không chạm PostgreSQL”, “DB down thì redirect vẫn chạy” hay cam kết tốc độ chỉ từ một demo. Muốn giảm cả write phải thiết kế counter/event queue riêng, nằm ngoài phạm vi bài học.

### 9.2. Sử dụng luồng cache hiện có

Không cần thay router, schema hay service ở bước này. `backend/app/api/urls.py` đã gọi `url_service.resolve_short_code` và `url_service.delete_url`; giữ nguyên validation, `responses` OpenAPI, status 302/404/410 và header `Cache-Control`.

- Cache MISS: SQL `UPDATE ... WHERE expires_at > now RETURNING original_url, expires_at` vừa tăng click vừa lấy destination hiện hành.
- Cache HIT: SQL UPDATE chỉ thành công nếu URL chưa hết hạn và destination khớp cache. Nếu không khớp, loại key cũ rồi kiểm tra lại DB.
- TTL không vượt `CACHE_TTL_SECONDS` hoặc thời gian link còn hiệu lực; TTL không dương thì không ghi cache.
- DELETE commit DB thành công trước khi invalidation.
- Redis lỗi thì fallback DB; DB lỗi trả 503. `logging.basicConfig(level=logging.INFO)` đã bật trong `app/main.py`.

Ở phần này chỉ thêm Redis service và đặt `REDIS_URL=redis://redis:6379/0` trong Compose, sau đó quan sát các hành vi có sẵn.

### 9.3. compose.yaml hoàn chỉnh sau khi thêm Redis

Thay file Compose bằng bản đầy đủ dưới đây. Redis chỉ nằm trong network data, không mở cổng ra host và không gắn volume vì đây là cache có thể tái tạo.

```yaml
name: url-shortener-seminar

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-shortener_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-shortener_password}
      POSTGRES_DB: ${POSTGRES_DB:-url_shortener}
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/001-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 10s
    networks: [data]

  redis:
    image: redis:8-alpine
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 2s
      retries: 15
    networks: [data]

  backend:
    image: url-shortener-backend:seminar
    build:
      context: ./backend
      target: runtime
    environment:
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-shortener_user}:${POSTGRES_PASSWORD:-shortener_password}@postgres:5432/${POSTGRES_DB:-url_shortener}
      REDIS_URL: redis://redis:6379/0
      CACHE_TTL_SECONDS: "3600"
      BASE_URL: http://localhost:8080
      CORS_ORIGINS: http://localhost:8080
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/app/health', timeout=2)"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s
    networks: [edge, data]

  frontend:
    image: url-shortener-frontend:seminar
    build: ./frontend
    ports: ["127.0.0.1:8080:8080"]
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
      interval: 5s
      timeout: 3s
      retries: 12
    networks: [edge]

  tests:
    profiles: [test]
    build:
      context: ./backend
      target: test
    environment:
      SMOKE_BASE_URL: http://backend:8000
    depends_on:
      backend:
        condition: service_healthy
    networks: [edge]

volumes:
  pg_data:

networks:
  edge:
  data:
    internal: true
```

Do `depends_on`, lần khởi động hệ thống mới chờ Redis healthy. Nếu Redis lỗi sau khi app đã chạy, không có healthcheck này tự dừng backend; code fallback vẫn dùng DB. Nếu muốn Redis hoàn toàn tùy chọn ngay cả khi startup, bỏ phụ thuộc Redis và thiết kế retry/readiness phù hợp; bài demo giữ cấu hình dễ quan sát.

```powershell
docker compose config --quiet
docker compose up -d --build --wait
docker compose exec redis redis-cli ping
docker compose --profile test run --build --rm tests
```

### 9.4. Chứng minh MISS, HIT và click count

Chạy trong PowerShell ở root:

```powershell
$demoPayload = @{
    original_url = 'https://example.com/docker-cache'
    expires_at = [DateTimeOffset]::UtcNow.AddMinutes(10).ToString('o')
} | ConvertTo-Json
$demoUrl = Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/urls -ContentType 'application/json' -Body $demoPayload
$shortCode = $demoUrl.short_code

docker compose exec redis redis-cli DEL "url:$shortCode"
curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8080/api/urls/$shortCode"
docker compose logs --since 1m backend
docker compose exec redis redis-cli GET "url:$shortCode"
docker compose exec redis redis-cli TTL "url:$shortCode"
```

Kỳ vọng HTTP 302, log `Cache MISS`, `Query PostgreSQL`, `Cached`; GET key trả destination, TTL dương và không quá 600 giây trong ví dụ này.

```powershell
curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8080/api/urls/$shortCode"
docker compose logs --since 1m backend
docker compose exec postgres psql -U shortener_user -d url_shortener -c "SELECT short_code,click_count FROM urls WHERE short_code='$shortCode';"
```

Lần hai vẫn HTTP 302, có log `Cache HIT`; click_count = 2 nếu chỉ hai request trên truy cập link. Browser, plugin preview hoặc test khác có thể tăng click nên không trộn chúng vào cùng phép đo. Không dùng `curl -L` cho demo này, vì nó follow redirect và có thể làm người xem tưởng mã cuối là mã của backend.

### 9.5. Chứng minh Redis lỗi vẫn fallback DB

```powershell
docker compose stop redis
curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8080/api/urls/$shortCode"
docker compose logs --since 1m backend
docker compose start redis
```

Kỳ vọng 302 và warning Redis unavailable; PostgreSQL vẫn hoạt động. Chờ `docker compose exec redis redis-cli ping` trả PONG trước khi tiếp tục. Không chạy lại `compose up` giữa lúc cố tình stop Redis, vì nó có thể tự start service và làm sai phép thử.

### 9.6. Invalidation và expiration

```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:8080/api/urls/$shortCode"
docker compose exec redis redis-cli EXISTS "url:$shortCode"
curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8080/api/urls/$shortCode"
```

Kỳ vọng EXISTS = 0 và GET = 404. Để chứng minh TTL/hết hạn, tạo một link mới với `AddSeconds(5)`, GET ngay để warm cache, chờ ít nhất 6 giây rồi GET lại: 410. Chạy smoke tests lần nữa để kiểm tra regression sau khi nối cache.

Không dùng `FLUSHALL` cho demo: chỉ `DEL` key do mình vừa tạo. Redis mất cache không được làm mất bản ghi trong PostgreSQL.

```powershell
Add-Content docs/seminar-checkpoints.md '09: Redis MISS/HIT, click counting, deletion invalidation, expiration and DB fallback verified.'
git add compose.yaml docs/seminar-checkpoints.md
git commit -m "seminar: add Redis service and verify existing cache flows"
git tag -a seminar/09-redis -m "Four-service architecture with observable cache behavior"
```

## 10. Docker architecture, test và CI

### 10.1. Ghép các thành phần đã xuất hiện

```mermaid
flowchart LR
    Browser[Browser trên host] -->|localhost:8080| Frontend[Nginx + static Next.js]
    subgraph Edge[edge network]
        Frontend -->|backend:8000 /api/urls| Backend[FastAPI]
        Tests[Container test tạm] -->|HTTP| Backend
    end
    subgraph Data[data network: internal]
        Backend -->|postgres:5432| PG[(PostgreSQL)]
        Backend -->|redis:6379| Redis[(Redis cache)]
    end
    PG --> Volume[(Named volume pg_data)]
    Init[init.sql trên host] -. read-only, lần init đầu .-> PG
    CLI[docker / docker compose CLI] --> Engine[Docker Engine / daemon]
    Registry[Registry: Docker Hub] -->|pull image| Engine
    Source[Dockerfile + source] -->|build| Engine
    Engine -. quản lý .-> Frontend
    Engine -. quản lý .-> Backend
    Engine -. quản lý .-> PG
    Engine -. quản lý .-> Redis
```

Compose là công cụ khai báo/quản lý, **không phải một container thường trực nằm giữa request**. Docker CLI gửi yêu cầu tới Engine; daemon quản lý image/container/network/volume. Browser chỉ gọi host port của Nginx. Khi redirect thành công, browser nhận Location và tự truy cập website đích; backend không tải website đó giúp browser.

| Tác vụ | Nơi chạy | Kết quả |
|---|---|---|
| `docker build` | Engine/builder | Image |
| `docker run` | Engine | Container từ image |
| `docker pull/push` | Engine/registry | Trao đổi image |
| `docker compose up` | Compose gọi Engine | Tạo/cập nhật các tài nguyên ứng dụng |
| Test HTTP | Container tests | Gọi backend thật, assert kết quả |
| Lưu URL | PostgreSQL → volume | Dữ liệu độc lập với container |

### 10.2. Ma trận kiểm thử phải diễn tập

| Test | Cách kiểm tra | Mong đợi |
|---|---|---|
| Cấu hình | `docker compose config --quiet` | Exit 0 |
| Boot | `docker compose up -d --build --wait` | Các service healthy |
| Liveness | `/app/health` | 200, healthy |
| CRUD/redirect | Test container | 201, list có bản ghi, 302, tăng click, 204, 404 |
| Hết hạn | Test container | 410 sau thời hạn |
| Cache | GET cùng code hai lần, xem log/key | MISS rồi HIT |
| Invalidation | DELETE rồi Redis EXISTS | Key biến mất |
| Redis lỗi | Stop riêng Redis rồi GET | 302 qua DB, warning |
| Volume | `up` → tạo URL → `down` → `up` | URL vẫn tồn tại |
| Browser | `localhost:8080` | Hero/form, logo, chip, Go, Refresh, Reset, Back to top |
| Origin | Inspect Network trong browser | Request cùng `localhost:8080`, không `backend:8000` |
| Isolation | Xem compose/ports | Chỉ frontend publish port |

Lệnh test trong container:

```powershell
docker compose --profile test run --build --rm tests
if ($LASTEXITCODE -ne 0) { throw 'Smoke tests failed' }
```

Test này gọi backend trực tiếp trên Docker network, chưa test reverse proxy. Kiểm tra **cùng test suite qua Nginx** từ host hoặc test container:

```powershell
docker compose --profile test run --rm -e SMOKE_BASE_URL=http://frontend:8080 tests
if ($LASTEXITCODE -ne 0) { throw 'Nginx proxy smoke tests failed' }
```

Frontend đã chạy sẵn từ `up --wait`; test service chỉ khai báo phụ thuộc backend, nên không dùng riêng lệnh trên để thay thế bước startup toàn hệ thống.

Smoke test xác minh HTTP qua backend và Nginx với PostgreSQL/Redis thật. Giữ nguyên unit tests và browser tests hiện có để kiểm tra các nhánh lỗi cùng hành vi giao diện; browser tests intercept API nên không thay smoke test kết nối thật.

### 10.3. Giữ CI local và bổ sung CI Docker

Workflow `.github/workflows/ci.yml` hiện tại được giữ nguyên như dưới đây. Backend cài dev lock có hash; frontend dùng npm ci và binary Playwright đã cài. Browser tests dùng static build cùng origin và API giả lập, độc lập với Docker.

```yaml
name: Local application checks

on:
  pull_request:
  push:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python -m pip install --require-hashes --only-binary=:all: -r backend/requirements-dev.txt
      - run: python -m pytest -q
        working-directory: backend

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: npm ci --ignore-scripts
        working-directory: frontend
      - run: node --test tests/api.test.mjs
        working-directory: frontend
      - run: npm run build
        working-directory: frontend
        env:
          NEXT_PUBLIC_API_BASE_URL: ''
      - run: ./node_modules/.bin/playwright install --with-deps chromium
        working-directory: frontend
      - run: npm run test:e2e
        working-directory: frontend
```

Sau khi tạo Dockerfile, init SQL, smoke script và Compose ở các phần trước, tạo thêm `.github/workflows/docker-smoke.yml`:

```yaml
name: Docker smoke

on:
  push:
  pull_request:

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - name: Validate configuration
        run: docker compose config --quiet
      - name: Build and start
        run: docker compose up -d --build --wait --wait-timeout 180
      - name: Test backend
        run: docker compose --profile test run --build --rm tests
      - name: Test through Nginx
        run: docker compose --profile test run --rm -e SMOKE_BASE_URL=http://frontend:8080 tests
      - name: Logs
        if: always()
        run: docker compose logs --no-color
      - name: Cleanup isolated CI environment
        if: always()
        run: docker compose down -v --remove-orphans
```

CI runner của job này là môi trường dùng một lần; `down -v` ở đây xóa volume test của job, không phải lệnh vận hành database thật. Workflow chỉ build/test, không đăng nhập registry, push image hay deploy. `.github/workflows/docker-smoke.yml` bổ sung kiểm thử tích hợp, chạy song song với `.github/workflows/ci.yml`; không thay thế workflow local.

### 10.4. Thực tế sử dụng và giới hạn

| Bối cảnh | Docker giúp gì | Việc vẫn phải làm |
|---|---|---|
| Development | Môi trường DB/cache và runtime đồng nhất | Quản lý env, bind mount/watch nếu cần hot reload |
| Testing | Khởi động phụ thuộc và chạy test lặp lại | Dữ liệu test độc lập, assertion có ý nghĩa |
| CI/CD | Build/test một image trước khi phân phối | Secret, quyền push, rollout/rollback |
| Deployment | Chạy artifact đã kiểm thử | TLS, backup, migration, giám sát, tài nguyên và cập nhật |

Best practices áp dụng ngay: không copy `.env`/`.venv`/`node_modules`; copy dependency manifest trước source; multi-stage frontend; backend non-root; chỉ publish cổng cần thiết; lưu PostgreSQL trong named volume; log ra stdout/stderr; tránh `--reload` trong image chạy; kiểm tra health và test HTTP riêng. [Build best practices](https://docs.docker.com/build/building/best-practices/)

Python đã khóa cả dependencies trực tiếp/gián tiếp và SHA256 trong `requirements.txt`/`requirements-dev.txt`; npm dùng `package-lock.json` và `npm ci --ignore-scripts`. CI và Dockerfile đều kiểm tra hash khi cài Python. Base image tags và package hệ thống của `playwright install --with-deps` vẫn có thể thay đổi; để release tái lập hơn, khóa image digest đã kiểm thử và quản lý nguồn package OS. Tag Git không tự khóa các tài nguyên bên ngoài.

Giới hạn cần nói đúng:

- Container không thay validation, auth, HTTPS hoặc quản trị secret. App demo hiện không phải dịch vụ công khai có phân quyền người dùng.
- Compose trên một máy không tự có HA, failover database hay autoscaling nhiều host.
- `restart` policy/healthcheck không sửa được lỗi code; volume không phải backup.
- Dữ liệu cũ cần migration; init SQL chỉ bootstrap database mới.
- Docker Desktop có VM và chi phí tài nguyên; image phải phù hợp CPU/OS.
- Trong kiến trúc cache này PostgreSQL vẫn cần hoạt động trên cache HIT để cập nhật click.

```powershell
Add-Content docs/seminar-checkpoints.md '10: Backend and Nginx HTTP tests pass; CI workflow and operational limits documented.'
git add .github/workflows/docker-smoke.yml backend/tests/smoke_api.py docs/seminar-checkpoints.md
git commit -m "seminar: test Docker architecture locally and in CI"
git tag -a seminar/10-architecture -m "Architecture and CI smoke checks complete"
```

## 11. Kết thúc và Q&A

### 11.1. Bài demo cuối trên môi trường đã chuẩn bị

```powershell
docker compose up -d --build --wait
docker compose ps
docker compose --profile test run --build --rm tests
docker compose --profile test run --rm -e SMOKE_BASE_URL=http://frontend:8080 tests
```

Mở `http://localhost:8080`. Tạo link 1 day, bấm Shorten/Expand nhiều lần để thấy không tạo thêm hàng; Reset để tạo link mới. Go mở website; Refresh cập nhật click; cuộn Recent URLs và Back to top. Chọn một code mới để demo MISS/HIT.

Chứng minh persistence cuối cùng: tạo một URL trên UI, ghi lại code, rồi:

```powershell
docker compose down
docker compose up -d --wait
```

Refresh UI và mở lại URL đó: dữ liệu PostgreSQL vẫn còn vì không dùng `-v`. Cache có thể bị mất vì Redis container mới không có persistence; lần GET tiếp theo dựng lại cache.

### 11.2. Câu chốt theo đúng vấn đề ban đầu

| Vấn đề đã gặp | Thành phần giải quyết |
|---|---|
| Máy mới thiếu Python package/runtime | Dockerfile và image |
| Image chưa được chạy | Container và lệnh run |
| App chạy nhưng browser không truy cập | Bind address và port mapping |
| Máy mới chưa có PostgreSQL | Registry và official image |
| Backend dùng nhầm localhost | User-defined network và DNS service |
| Tạo lại DB container không thấy dữ liệu | Named volume |
| Nhiều lệnh thủ công khó lặp lại | Compose và healthcheck |
| Destination bị đọc lặp lại | Redis cache-aside, TTL và invalidation |
| Không biết bản đóng gói còn chạy đúng | HTTP smoke tests và CI |

Q&A gợi ý:

1. `EXPOSE` khác `ports` thế nào? Một cái mô tả, một cái publish cổng.
2. Vì sao đổi env mà DB password chưa đổi? Volume đã init; biến init không tự thay database có sẵn.
3. Vì sao browser không gọi `backend:8000`? DNS đó chỉ có ý nghĩa trong Docker network.
4. Vì sao sửa source chưa thấy trong container? Image/container cũ, cần rebuild/recreate hoặc dev bind mount.
5. Vì sao cache HIT vẫn có SQL? Thiết kế này giữ click count và kiểm tra tính hợp lệ ở DB.
6. Vì sao tạo container mới mà dữ liệu vẫn còn? Cùng named volume được gắn lại.
7. Git tag và image tag có giống nhau? Một cái trỏ source commit, một cái đặt tên image; không chứa database data.

### 11.3. Chốt tag sau khi diễn tập thành công

```powershell
Add-Content docs/seminar-checkpoints.md '11: End-to-end rehearsal, persistence restart and Q&A checklist complete.'
git add docker_integration.md docs/seminar-checkpoints.md
git commit -m "seminar: finalize Docker learning walkthrough and rehearsal notes"
git tag -a seminar/11-final -m "Final seminar architecture rehearsed successfully"
git tag --list 'seminar/*'
git log --oneline --decorate -15
```

Chỉ push khi bạn muốn chia sẻ repository; lệnh mẫu:

```powershell
git push -u origin feature/docker
git push origin 'refs/tags/seminar/*'
```

Không tạo sẵn các tag phần 1–11 trên commit cuối. Nếu đã làm hết mà quên tag, chỉ gắn tag vào commit lịch sử thực sự đại diện cho checkpoint đó. Git tag không chạy lại container; dùng worktree và lệnh runtime đúng với giai đoạn.

## Phụ lục: xử lý lỗi và tài liệu chính thức

### A. Khi demo lỗi, kiểm tra theo thứ tự

| Triệu chứng | Cách kiểm tra/sửa |
|---|---|
| Docker CLI có version nhưng không kết nối Engine | Mở Docker Desktop, chọn Linux containers; kiểm tra quyền/context bằng `docker context ls`, không vội sửa source |
| `port is already allocated` | Dừng đúng service đang chiếm cổng hoặc đổi host port; đừng đổi container port ngẫu nhiên |
| Backend health pass nhưng tạo URL lỗi | Kiểm tra SQL schema, credentials và network; health hiện tại không query DB |
| `connection refused` từ backend | Local dùng localhost; container dùng service DNS; container-to-container dùng port nội bộ |
| `password authentication failed` sau sửa env | Volume có credentials cũ; cập nhật role qua quản trị DB hoặc dùng volume demo mới có tên khác |
| `column expires_at does not exist` | DB còn schema cũ; init.sql không migrate bảng đã có |
| UUID không khớp cột id | DB còn SERIAL; migrate hoặc dùng DB demo mới |
| CORS lỗi trên local | `allow_origins=settings.cors_origin_list`; origin gồm scheme/host/port chính xác |
| Frontend gọi localhost:8000 khi Docker | Bundle bị build bằng env local; kiểm tra `.dockerignore`, rebuild frontend với API base rỗng |
| Nginx 502 | Backend healthy chưa? DNS service có đúng `backend`? Cùng edge network? Xem logs frontend/backend |
| Không thấy cache logs | Kiểm tra REDIS_URL trong container và xem log backend; endpoint hiện đã gọi service, logging INFO đã bật |
| Redis ngừng hoạt động | Backend hiện fallback PostgreSQL; kiểm tra DB còn hoạt động và tìm warning trong log |
| Chuyển git tag nhưng `.env`/DB vẫn giữ nguyên | Đó là trạng thái runtime ngoài Git; tạo env/network/volume đúng cho checkpoint |

Các lệnh chẩn đoán:

```powershell
docker compose ps
docker compose logs --tail 100 backend postgres redis frontend
docker compose exec backend python -c "import socket; print(socket.gethostbyname('postgres'))"
docker compose exec postgres pg_isready -h 127.0.0.1 -U shortener_user -d url_shortener
docker compose exec redis redis-cli ping
docker network ls
docker volume ls
```

`docker compose config` có thể hiển thị credentials sau interpolation; dùng `--quiet` khi chỉ validate hoặc khi quay màn hình. Không chụp/publish output có secret thật.

### B. Dọn sân khấu sau bài học

Giữ dữ liệu Compose:

```powershell
docker compose down
```

Chỉ khi muốn **xóa toàn bộ DB demo Compose**:

```powershell
docker compose down -v
```

Volume thủ công `seminar-pg-data` độc lập, không bị lệnh Compose trên xóa. Kiểm tra `docker ps -a`/`docker volume inspect` trước khi dọn các container/volume thủ công đã biết tên. Không dùng `docker system prune --volumes` hoặc wildcard delete để dọn một buổi seminar.

### C. Tài liệu để đọc tiếp

- [Cài Docker Desktop trên Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/).
- [Image build cache](https://docs.docker.com/build/cache/).
- [Compose services reference](https://docs.docker.com/reference/compose-file/services/).
- [Profiles và service kiểm thử](https://docs.docker.com/compose/how-tos/profiles/).
- [Docker Hub PostgreSQL](https://hub.docker.com/_/postgres).
- [Redis trên Docker](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/docker/).
- [PostgreSQL logical backup](https://www.postgresql.org/docs/17/backup-dump.html).

### D. Phạm vi xác minh tài liệu

Tài liệu được đối chiếu với source dự án và tài liệu chính thức; các ví dụ Python hoàn chỉnh và hai cấu hình Compose được kiểm tra cú pháp trong quá trình soạn. Việc đọc/check cấu hình không thay thế chạy tuần tự Docker build/up/smoke trên máy trình bày. Ghi kết quả chạy thật vào nhật ký trước khi gắn từng tag; không tuyên bố các checkpoint đã pass chỉ vì file hướng dẫn được tạo.

Tài liệu đã được cập nhật theo baseline local: dependency locks có hash, unit tests độc lập DB local, CI gọi Playwright đã cài, và menu tag bắt đầu bằng `seminar/00-local`. Kết quả chạy local không thay thế diễn tập Docker trên máy trình bày. Chưa xác nhận các bước build/up/smoke của toàn bộ walkthrough sau lần cập nhật này; ghi kết quả thực tế trước khi tạo tag.

Kiểm tra bản cập nhật: 2 code block Python và 59 code block PowerShell parse thành công; hai cấu hình Compose qua `docker compose config --quiet`; 12 tag trong tài liệu khớp đúng thứ tự menu; snapshot `ci.yml` khớp workflow hiện có. Đã thử chọn `seminar/00-local` và trường hợp thiếu tag trong repository tạm, không chuyển nhánh dự án thật.
