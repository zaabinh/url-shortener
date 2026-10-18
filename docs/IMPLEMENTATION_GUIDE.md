# URL Shortener — Step-by-Step Implementation Guide

> Seminar topic: **Docker**. The URL Shortener is the demo application.
> The app is kept deliberately small so that every phase can focus on one Docker concept.

**Stack:** Next.js 16 (React 19, static export) · Python 3.12 + FastAPI · SQLAlchemy 2 · PostgreSQL 16 · Redis 7 · Nginx · Docker · Docker Compose

---

## Table of Contents

- [Current Repository Assessment](#current-repository-assessment)
- [Design Decisions](#design-decisions)
- [Conventions Used in This Guide](#conventions-used-in-this-guide)
- [Phase 0 — Repository Setup and Baseline](#phase-0--repository-setup-and-baseline)
- [Phase 1 — URL Shortener MVP](#phase-1--url-shortener-mvp)
- [Phase 2 — PostgreSQL Persistence](#phase-2--postgresql-persistence)
- [Phase 3 — Dockerize the FastAPI Backend](#phase-3--dockerize-the-fastapi-backend)
- [Phase 4 — Dockerize the Frontend](#phase-4--dockerize-the-frontend)
- [Phase 5 — PostgreSQL Container and Docker Networking](#phase-5--postgresql-container-and-docker-networking)
- [Phase 6 — Docker Volume](#phase-6--docker-volume)
- [Phase 7 — Docker Compose](#phase-7--docker-compose)
- [Phase 8 — Redis Cache](#phase-8--redis-cache)
- [Phase 9 — Health Checks and Startup Reliability](#phase-9--health-checks-and-startup-reliability)
- [Phase 10 — Testing, Cleanup, and Seminar Preparation](#phase-10--testing-cleanup-and-seminar-preparation)
- [Final Architecture](#final-architecture)
- [Final Project Structure](#final-project-structure)
- [Development Roadmap](#development-roadmap)
- [Appendix — Optional Extension: Custom Alias](#appendix--optional-extension-custom-alias)

---

## Current Repository Assessment

Snapshot taken from branch `master` (one commit: `chore: add initial project structure with empty files`, plus uncommitted frontend work).

| Status | Item |
|---|---|
| ✅ **Exists and works** | A **Next.js** frontend (App Router, JavaScript, `output: 'export'`): `frontend/app/layout.jsx`, `frontend/app/page.jsx`, `frontend/components/UrlForm.jsx`, `frontend/lib/api.js`, `frontend/css/style.css`, `frontend/css/reset.css`. Together they are a styled single-page form with a drag/click "Shorten it! / Expand it!" toggle. The form calls `POST /api/urls` with `{ "original_url": ... }` and expects `{ "short_url": ... }` back. The API base URL comes from `NEXT_PUBLIC_API_BASE_URL`: `frontend/.env.development` sets it to `http://localhost:8000` for `npm run dev`; production builds leave it empty, so requests go to the same origin. (The frontend started as plain HTML/CSS/JS and was ported to Next.js. A multi-stage Docker build then makes the Node.js toolchain an image concern, not a laptop concern.) |
| 🟡 **Partially implemented** | `frontend/app/page.jsx` has an empty "Recent URLs" section (`.url-list`), but there is no list, click count, copy or delete UI yet. `backend/requirements.txt` lists `fastapi`, `uvicorn`, `sqlalchemy` and `psycopg` without versions. Plain `psycopg` also needs a system `libpq`, so it fails on Windows and in slim images unless you use `psycopg[binary]`. |
| ⬜ **Placeholder only (0 bytes)** | Every backend Python file (`main.py`, `api/urls.py`, `core/config.py`, `db/*.py`, `schemas/url.py`, `services/*.py`, `utils/short_code.py`), `backend/tests/*.py`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `compose.yaml`, `docker/postgres/init.sql`, `.env.example`, `.gitignore` and `README.md`. |
| ❌ **Missing** | `docs/` (created by this guide), `backend/.dockerignore`, `backend/.env.example`, `backend/requirements-dev.txt`, `backend/tests/conftest.py`, `frontend/.dockerignore`, `frontend/assets/` (not needed; see below). |
| ⚠️ **Problem** | `.env` **is committed to git** and `.gitignore` is empty. Fix this in Phase 0 so real credentials are never committed. |

**Reuse:** all existing frontend code and its visual style, the existing directory layout (it already matches the target structure), and the dependency choices in `requirements.txt`.
**Refactor:** `frontend/lib/api.js` (shared request helper, list and delete calls) and `frontend/components/UrlForm.jsx` (show server error messages, notify the page when a URL is created).
**Add:** the whole backend implementation, a `RecentUrls` component, the Dockerfiles (the frontend one is a **multi-stage** Node → Nginx build), `frontend/.dockerignore`, `nginx.conf`, `compose.yaml`, `init.sql`, environment examples, tests and README.

### Deviations from the suggested structure

| Deviation | Reason |
|---|---|
| Next.js instead of `index.html` + `js/` | Same UI and behavior, but a real build toolchain (Node.js, `npm`, about 50 packages). It makes the Docker benefits concrete: a multi-stage build, a large build context that needs `.dockerignore`, and a final image with no Node.js. `frontend/js/` and `index.html` are replaced by `app/`, `components/` and `lib/`. |
| Static export (`output: 'export'`) served by Nginx | `next build` produces plain files in `out/`. Nginx stays the single entry point and reverse proxy, so the networking design does not change. (The alternative is a standalone Next.js server, `output: 'standalone'`, with no Nginx. It needs a Node runtime in production, and Next.js fixes its proxy rewrites at build time, so it is not used here.) |
| `frontend/css/` kept (global CSS) | The existing stylesheets are imported once in `app/layout.jsx`. `style.css` still imports `reset.css`. |
| `frontend/assets/` not created | The UI has no images. Git does not track empty folders. Create it only when you need it. |
| `backend/.env.example` added (in addition to root `.env.example`) | Local development (backend on the host → `localhost` database) and Docker Compose (backend in a container → `postgres` service) need **different** hostnames. Two files make the difference explicit, which is also the lesson of Demo 4. |
| `backend/requirements-dev.txt` added | Test-only dependencies (`pytest`, `httpx`) stay out of the production image. |
| `backend/tests/conftest.py` added | Shared pytest fixture (test client, test database). |
| `backend/.dockerignore` added | Keeps `.venv`, `.env` and caches out of the build context. |
| Health endpoint lives in `backend/app/main.py` | It is about 15 lines, so a separate `api/health.py` would add a file without adding clarity. |

---

## Design Decisions

These decisions apply to every phase. Read them once before you start.

1. **Nginx is the single entry point in Docker.** The browser only talks to `http://localhost:8080`. Nginx serves the Next.js static export, proxies `/api/*` to FastAPI, and proxies any path that is not a static file (for example `/aB3dE9x`) to FastAPI as a short code. Production builds call the API on the same origin, which makes short links look like `http://localhost:8080/aB3dE9x` and avoids CORS in Docker.
2. **Local development (Phases 0–2) runs the Next.js dev server on port 3000 and FastAPI on port 8000.** `frontend/.env.development` sets `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`. Next.js inlines `NEXT_PUBLIC_*` values **at build time**, and only `next dev` reads `.env.development`, so a production build has an empty base URL. FastAPI allows `http://localhost:3000` through CORS.
3. **Redirects use HTTP `302`, not `301`.** Browsers cache `301` permanently, so a second click would never reach the server. That would break the click counter and the Redis demo.
4. **Configuration comes only from environment variables**: `DATABASE_URL`, `REDIS_URL`, `BASE_URL`, `CORS_ORIGINS` and `CACHE_TTL_SECONDS`. No container IP addresses appear anywhere, only service names (`postgres`, `redis`, `backend`).
5. **The schema is created by SQLAlchemy at startup** (`Base.metadata.create_all`). Alembic migrations are out of scope for a Docker seminar. `docker/postgres/init.sql` mirrors the same schema and seeds one demo row (`/docker`) so the cache demo has a stable short code.
6. **Redis is optional at runtime.** If Redis is unset or down, the backend logs a warning and falls back to PostgreSQL. Tests and Phases 2–7 run without Redis.
7. **Pinned images:** `python:3.12-slim`, `node:22-alpine` (frontend build stage only), `nginx:1.27-alpine`, `postgres:16-alpine`, `redis:7-alpine`.
   > ⚠️ Do not switch to `postgres:18`+ without changing the volume path. Those images store data under `/var/lib/postgresql/<major>/docker` and expect the volume at `/var/lib/postgresql`.

---

## Conventions Used in This Guide

- **Working directory** is stated before each command block. "repo root" means the folder that contains `compose.yaml`.
- Multi-line commands use `\` (bash, Git Bash, macOS, Linux). In **PowerShell** either put the command on one line or replace `\` with a backtick `` ` ``.
- In **Windows PowerShell 5.1**, `curl` is an alias for `Invoke-WebRequest`. Type **`curl.exe`** to get real curl. Also do not chain commands with `&&`; run them on separate lines.
- `NEW` = create the file. `FILL` = the file exists but is empty. `MODIFY` = change existing content.
- Lines marked `> SEMINAR DEMO CHECKPOINT` are live-demo moments.

### Evolution of the application

```mermaid
flowchart LR
    A[Local app<br/>Phase 0-2] --> B[Backend image<br/>Phase 3]
    B --> C[Backend container<br/>Phase 3]
    C --> D[Frontend container<br/>Phase 4]
    D --> E[PostgreSQL container<br/>+ Docker network<br/>Phase 5]
    E --> F[Docker volume<br/>Phase 6]
    F --> G[Docker Compose<br/>Phase 7]
    G --> H[Redis<br/>Phase 8]
    H --> I[Health checks<br/>Phase 9]
    I --> J[Complete app<br/>Phase 10]
```

---

## Phase 0 — Repository Setup and Baseline

**Goal:** the frontend and FastAPI both run locally, and `GET /api/health` succeeds.
**Why:** before anything goes into a container, everyone needs a known-good baseline and a working toolchain.

### Required tools

| Tool | Version | Needed from |
|---|---|---|
| Git | any recent | Phase 0 |
| Python | 3.12 (3.11+ works) | Phase 0 |
| Node.js + npm | **20.9+** (Next.js 16 requirement; 22 LTS recommended) | Phase 0 (local development only; Docker builds bring their own Node) |
| A browser + VS Code | — | Phase 0 |
| PostgreSQL (local install) | 16 | Phase 2 |
| Docker Desktop (Windows/macOS) or Docker Engine (Linux) | Compose **v2.24+** | Phase 3 |

Check: `git --version`, `python --version`, `node --version`, `npm --version`, `docker --version`, `docker compose version`.

### Files

| Action | File |
|---|---|
| FILL | `.gitignore`, `backend/app/core/config.py`, `backend/app/main.py`, `backend/tests/test_health.py` |
| MODIFY | `backend/requirements.txt` |
| NEW | `backend/.env.example`, `backend/requirements-dev.txt`, `backend/tests/conftest.py` |
| GIT | stop tracking `.env` |

### Step 0.1 — Repository hygiene

`.gitignore` (FILL)

```gitignore
# Python
__pycache__/
*.py[cod]
.venv/
venv/
.pytest_cache/
*.db

# Environment files with real values (examples are committed)
.env

# Editors / OS
.idea/
.DS_Store
Thumbs.db

# Node / Next.js
node_modules/
.next/
out/
next-env.d.ts
```

The `.env` pattern matches `.env` in every folder (root and `backend/`), but not `.env.example` or `frontend/.env.development`. The latter holds no secrets and is committed on purpose.

Stop tracking the committed `.env` without deleting your local copy. Run from the repo root:

```bash
git rm --cached .env
git add .gitignore
git commit -m "chore: ignore .env files"
```

### Step 0.2 — Dependencies

`backend/requirements.txt` (MODIFY: add version ranges, switch to `psycopg[binary]`, add `pydantic-settings` and `redis`)

```text
fastapi>=0.115,<1.0
uvicorn>=0.30,<1.0
pydantic-settings>=2.4,<3.0
sqlalchemy>=2.0,<2.1
psycopg[binary]>=3.2,<4.0
redis>=5.0,<7.0
```

| Package | Used for | First used in |
|---|---|---|
| `fastapi` | web framework | Phase 0 |
| `uvicorn` | ASGI server that runs FastAPI | Phase 0 |
| `pydantic-settings` | reads environment variables / `.env` into a typed `Settings` object | Phase 0 |
| `sqlalchemy` | ORM | Phase 2 |
| `psycopg[binary]` | PostgreSQL driver; `[binary]` bundles `libpq`, so no system install is needed (Windows, slim images) | Phase 2 |
| `redis` | Redis client | Phase 8 |

We install everything now so the dependency list, and later the Docker image layer, stays stable across phases.

`backend/requirements-dev.txt` (NEW)

```text
-r requirements.txt
pytest>=8.0,<9.0
httpx>=0.27,<1.0
```

### Step 0.3 — Python virtual environment

Working directory: `backend/`

```bash
python -m venv .venv

# Activate — pick ONE:
.venv\Scripts\Activate.ps1        # Windows PowerShell
source .venv/Scripts/activate     # Windows Git Bash
source .venv/bin/activate         # macOS / Linux

pip install -r requirements-dev.txt
```

> If PowerShell refuses to run `Activate.ps1`, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Step 0.4 — Environment configuration

`backend/.env.example` (NEW). This file is for **local development only**, when uvicorn runs on your machine from `backend/`.

```dotenv
# Local development settings, read by app/core/config.py when uvicorn runs from backend/.
# Copy to backend/.env (never commit the real .env).

# Public origin used to build short links
BASE_URL=http://localhost:8000

# Origins allowed to call the API from another port (the Next.js dev server)
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Phase 2+: PostgreSQL installed on this machine
DATABASE_URL=postgresql+psycopg://shortener:shortener@localhost:5432/shortener

# Phase 8+: leave empty to disable caching when running locally without Redis
REDIS_URL=
CACHE_TTL_SECONDS=3600
```

Working directory: `backend/`

```bash
cp .env.example .env
```

`backend/app/core/config.py` (FILL). This is the final version. Settings that later phases use are already declared, so this file never needs to change again.

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings.

    Values come from environment variables. During local development they can
    also come from backend/.env. Real environment variables always win over
    the .env file, which is how Docker passes configuration in.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "URL Shortener"

    # Public origin used to build short links, e.g. http://localhost:8080/aB3dE9x
    base_url: str = "http://localhost:8000"

    # Comma-separated origins allowed to call the API cross-origin (local dev only)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    short_code_length: int = 7

    # Phase 2+. No default on purpose: a missing value must fail loudly
    # instead of silently connecting to the wrong database.
    database_url: str = ""

    # Phase 8+. Empty string disables caching.
    redis_url: str = ""
    cache_ttl_seconds: int = 3600

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def short_url(self, short_code: str) -> str:
        return f"{self.base_url.rstrip('/')}/{short_code}"


settings = Settings()
```

Environment variable names map to fields case-insensitively: `DATABASE_URL` → `database_url`.

### Step 0.5 — Minimal FastAPI app with a health endpoint

`backend/app/main.py` (FILL, Phase 0 version)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

app = FastAPI(title=settings.app_name)

# Needed only when the frontend is served from another origin (Next.js dev server on :3000).
# Behind Nginx (Phase 4+) the frontend and API share one origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}
```

The existing empty `__init__.py` files already turn `app/`, `app/api/`, `app/core/` and the rest into packages. Leave them empty.

### Step 0.6 — First tests

`backend/tests/conftest.py` (NEW, Phase 0 version; extended in Phase 2)

```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    # The context manager runs the app's startup/shutdown (lifespan) events.
    with TestClient(app) as test_client:
        yield test_client
```

`backend/tests/test_health.py` (FILL)

```python
def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

### Run

Terminal 1, working directory `backend/` (venv active):

```bash
uvicorn app.main:app --reload --port 8000
```

Terminal 2, working directory `frontend/`:

```bash
npm install      # first time only: downloads Next.js and React into node_modules/
npm run dev      # Next.js dev server with hot reload on http://localhost:3000
```

Terminal 3, working directory `backend/`:

```bash
python -m pytest
```

### Verify

| Check | Expected |
|---|---|
| <http://localhost:8000/api/health> | `{"status":"ok"}` |
| <http://localhost:8000/docs> | Swagger UI listing `GET /api/health` |
| <http://localhost:3000> | The existing "Make your URL shorter" page renders. Shortening fails for now because there is no endpoint yet. |
| `python -m pytest` | `1 passed` |

> **Troubleshooting:** `npm run dev` fails with *"You are using Node.js 18… required >=20.9.0"* → upgrade Node.js. The browser console shows a CORS error → `CORS_ORIGINS` in `backend/.env` must contain `http://localhost:3000`; restart uvicorn after changing it.

**Checkpoint**

```text
Frontend running locally   → http://localhost:3000
FastAPI running locally    → http://localhost:8000
GET /api/health            → {"status": "ok"}
```

---

## Phase 1 — URL Shortener MVP

**Goal:** a working URL shortener with an **in-memory** store, covering create, list, redirect, click count, copy and delete.
**Why:** prove the application logic and API contract before adding a database or Docker. The in-memory store also loses all data on restart, which motivates Phase 2.

### REST API design

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| `POST` | `/api/urls` | `{"original_url": "https://..."}` | `201` + URL object | `422` invalid URL |
| `GET` | `/api/urls?limit=20` | — | `200` + list (newest first) | `422` bad limit |
| `DELETE` | `/api/urls/{short_code}` | — | `204` | `404` unknown code |
| `GET` | `/{short_code}` | — | `302` redirect, `Location: <original>` | `404` unknown code |
| `GET` | `/api/health` | — | `200 {"status":"ok"}` | — |

URL object:

```json
{
  "short_code": "aB3dE9x",
  "short_url": "http://localhost:8000/aB3dE9x",
  "original_url": "https://docs.docker.com/get-started/",
  "click_count": 0,
  "created_at": "2026-10-17T08:30:00+00:00"
}
```

### Request flow

```mermaid
sequenceDiagram
    participant B as Browser (Next.js page)
    participant A as FastAPI
    participant S as url_service
    B->>A: POST /api/urls {original_url}
    A->>A: Pydantic validates HttpUrl (422 if invalid)
    A->>S: create_url()
    S->>S: generate_short_code() (retry on collision)
    S-->>A: record
    A-->>B: 201 {short_code, short_url, ...}
    B->>A: GET /api/urls
    A-->>B: 200 [ ... ]
    Note over B,A: User clicks the short link
    B->>A: GET /aB3dE9x
    A->>S: resolve_short_code() → click_count += 1
    A-->>B: 302 Location: https://docs.docker.com/...
```

### Files

| Action | File |
|---|---|
| FILL | `backend/app/utils/short_code.py`, `backend/app/schemas/url.py`, `backend/app/services/url_service.py`, `backend/app/api/urls.py`, `backend/tests/test_urls.py` |
| NEW | `frontend/lib/utils.js`, `frontend/components/RecentUrls.jsx` |
| MODIFY | `backend/app/main.py`, `frontend/lib/api.js`, `frontend/components/UrlForm.jsx`, `frontend/app/page.jsx`, `frontend/css/style.css` |

### Step 1.1 — Short-code generation

`backend/app/utils/short_code.py` (FILL)

```python
import secrets
import string

ALPHABET = string.ascii_letters + string.digits  # 62 characters


def generate_short_code(length: int = 7) -> str:
    """Return a random code such as 'aB3dE9x'.

    62^7 ≈ 3.5 trillion combinations, so collisions are rare. The service
    still checks for them. `secrets` is used instead of `random` so codes
    cannot be predicted.
    """
    return "".join(secrets.choice(ALPHABET) for _ in range(length))
```

### Step 1.2 — Request/response schemas (URL validation)

`backend/app/schemas/url.py` (FILL, final version)

```python
from datetime import datetime

from pydantic import BaseModel, HttpUrl, field_validator

MAX_URL_LENGTH = 2048  # matches the database column in Phase 2


class UrlCreate(BaseModel):
    # HttpUrl accepts only absolute http:// or https:// URLs.
    # Anything else ("abc", "ftp://...", "") is rejected with 422.
    original_url: HttpUrl

    @field_validator("original_url")
    @classmethod
    def limit_length(cls, value: HttpUrl) -> HttpUrl:
        if len(str(value)) > MAX_URL_LENGTH:
            raise ValueError(f"URL must be at most {MAX_URL_LENGTH} characters")
        return value


class UrlResponse(BaseModel):
    short_code: str
    short_url: str
    original_url: str
    click_count: int
    created_at: datetime
```

> Pydantic normalizes URLs: `https://example.com` is stored as `https://example.com/`.

### Step 1.3 — In-memory service

`backend/app/services/url_service.py` (FILL, **Phase 1 version**, replaced in Phase 2)

```python
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.core.config import settings
from app.utils.short_code import generate_short_code

MAX_ATTEMPTS = 5


@dataclass
class UrlRecord:
    short_code: str
    original_url: str
    click_count: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# Phase 1 only: data lives in the process memory and disappears on restart.
_urls: dict[str, UrlRecord] = {}


def _unique_short_code() -> str:
    for _ in range(MAX_ATTEMPTS):
        code = generate_short_code(settings.short_code_length)
        if code not in _urls:
            return code
    raise RuntimeError("Could not generate a unique short code")


def create_url(original_url: str) -> UrlRecord:
    record = UrlRecord(short_code=_unique_short_code(), original_url=original_url)
    _urls[record.short_code] = record
    return record


def list_urls(limit: int) -> list[UrlRecord]:
    return list(reversed(_urls.values()))[:limit]


def get_url(short_code: str) -> UrlRecord | None:
    return _urls.get(short_code)


def delete_url(short_code: str) -> bool:
    return _urls.pop(short_code, None) is not None


def resolve_short_code(short_code: str) -> str | None:
    """Return the original URL and count the click, or None if unknown."""
    record = _urls.get(short_code)
    if record is None:
        return None
    record.click_count += 1
    return record.original_url
```

### Step 1.4 — API routes

`backend/app/api/urls.py` (FILL, **Phase 1 version**)

```python
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.schemas.url import UrlCreate, UrlResponse
from app.services import url_service

router = APIRouter(prefix="/api/urls", tags=["urls"])
redirect_router = APIRouter(tags=["redirect"])


def to_response(url) -> UrlResponse:
    return UrlResponse(
        short_code=url.short_code,
        short_url=settings.short_url(url.short_code),
        original_url=url.original_url,
        click_count=url.click_count,
        created_at=url.created_at,
    )


@router.post("", response_model=UrlResponse, status_code=status.HTTP_201_CREATED)
def create_short_url(payload: UrlCreate):
    url = url_service.create_url(str(payload.original_url))
    return to_response(url)


@router.get("", response_model=list[UrlResponse])
def list_short_urls(limit: int = Query(20, ge=1, le=100)):
    return [to_response(url) for url in url_service.list_urls(limit)]


@router.delete("/{short_code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_short_url(short_code: str):
    if not url_service.delete_url(short_code):
        raise HTTPException(status_code=404, detail="Short URL not found")


@redirect_router.get("/{short_code}")
def redirect_to_original(short_code: str):
    original_url = url_service.resolve_short_code(short_code)
    if original_url is None:
        raise HTTPException(status_code=404, detail="Short URL not found")
    # 302 (not 301): browsers must not cache the redirect, otherwise
    # repeat clicks never reach the server (no click count, no cache demo).
    return RedirectResponse(original_url, status_code=status.HTTP_302_FOUND)
```

`backend/app/main.py` (MODIFY, **Phase 1 version**: logging and routers added)

```python
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.urls import redirect_router, router as urls_router
from app.core.config import settings

# Application logs ([DATABASE], [REDIS]) use the same style as uvicorn's logs.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(urls_router)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}


# Registered last: "/{short_code}" matches any single-segment path.
app.include_router(redirect_router)
```

### Step 1.5 — Frontend: API client

`frontend/lib/api.js` (MODIFY: replace the whole file). The existing `shortenUrl()` contract and its `short_url` protocol check are kept. A shared `request()` helper adds readable server errors, plus `listUrls()` and `deleteUrl()`.

```javascript
// Empty in production builds: the API is served on the same origin through Nginx.
// `npm run dev` reads frontend/.env.development, which points to FastAPI on :8000.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        throw new Error('Cannot reach the shortening service. Check that the backend is running.');
    }

    if (!response.ok) {
        throw new Error(await readError(response));
    }
    return response.status === 204 ? null : response.json();
}

async function readError(response) {
    try {
        const data = await response.json();
        if (typeof data.detail === 'string') return data.detail;
        // FastAPI validation errors (422) return a list of problems.
        if (Array.isArray(data.detail)) return 'Enter a valid URL starting with http:// or https://.';
    } catch {
        // Non-JSON body, e.g. a 502 page from Nginx.
    }
    return `The service responded with an error (${response.status}). Please try again later.`;
}

// The backend accepts { original_url } and returns the created URL record, including short_url.
export async function shortenUrl(originalUrl) {
    const data = await request('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_url: originalUrl }),
    });

    const shortUrl = new URL(data.short_url);
    if (!['http:', 'https:'].includes(shortUrl.protocol)) {
        throw new Error('The service returned an invalid URL.');
    }
    return shortUrl.href;
}

export function listUrls(limit = 20) {
    return request(`/api/urls?limit=${limit}`);
}

export function deleteUrl(shortCode) {
    return request(`/api/urls/${encodeURIComponent(shortCode)}`, { method: 'DELETE' });
}
```

### Step 1.6 — Frontend: helpers

`frontend/lib/utils.js` (NEW)

```javascript
export function formatDate(isoString) {
    return new Date(isoString).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

export function formatClicks(count) {
    return count === 1 ? '1 click' : `${count} clicks`;
}
```

### Step 1.7 — Frontend: Recent URLs component (list, copy, delete, click count)

`frontend/components/RecentUrls.jsx` (NEW). React escapes text it renders, so user-supplied URLs cannot inject HTML.

```jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { deleteUrl, listUrls } from '../lib/api';
import { formatClicks, formatDate } from '../lib/utils';

export default function RecentUrls({ refreshKey }) {
    const [urls, setUrls] = useState([]);
    const [message, setMessage] = useState('Loading…');
    const [deleting, setDeleting] = useState(null);

    const loadUrls = useCallback(async () => {
        try {
            const data = await listUrls();
            setUrls(data);
            setMessage(data.length ? '' : 'No URLs yet. Shorten one above.');
        } catch (error) {
            setMessage(error.message);
        }
    }, []);

    // Reload on first render and whenever the form creates a URL.
    useEffect(() => {
        loadUrls();
    }, [loadUrls, refreshKey]);

    // Short links open in a new tab; refresh click counts when the user comes back.
    useEffect(() => {
        function handleVisibility() {
            if (document.visibilityState === 'visible') loadUrls();
        }
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [loadUrls]);

    async function handleCopy(shortUrl) {
        try {
            await navigator.clipboard.writeText(shortUrl);
            setMessage('Short URL copied to clipboard.');
        } catch {
            setMessage('Could not copy. Select the link and copy it manually.');
        }
    }

    async function handleDelete(shortCode) {
        setDeleting(shortCode);
        try {
            await deleteUrl(shortCode);
            await loadUrls();
        } catch (error) {
            setMessage(error.message);
        } finally {
            setDeleting(null);
        }
    }

    return (
        <>
            <p className="url-empty" role="status" aria-live="polite">{message}</p>
            <ul className="url-items">
                {urls.map((url) => (
                    <li key={url.short_code} className="url-item">
                        <a className="url-item-short" href={url.short_url} target="_blank" rel="noopener">
                            {url.short_url}
                        </a>
                        <p className="url-item-original" title={url.original_url}>{url.original_url}</p>
                        <p className="url-item-meta">
                            {formatClicks(url.click_count)} · {formatDate(url.created_at)}
                        </p>
                        <div className="url-item-actions">
                            <button type="button" onClick={() => handleCopy(url.short_url)}>Copy</button>
                            <button
                                type="button"
                                disabled={deleting === url.short_code}
                                onClick={() => handleDelete(url.short_code)}
                            >
                                Delete
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}
```

### Step 1.8 — Frontend: wire the form and the list together

`frontend/components/UrlForm.jsx` (MODIFY). The existing toggle/drag logic stays as it is. Make two edits:

**(a)** Accept an `onCreated` callback:

```jsx
// before
export default function UrlForm() {
// after
export default function UrlForm({ onCreated }) {
```

**(b)** In `switchUrl()`, notify the page after a successful shorten and show the server's error message:

```jsx
// before
            announce('Short URL ready in the field. Click or stretch the button right to restore the original.');
        } catch {
            setMode('long');
            announce('Could not shorten this URL. Check that the shortening service is running and try again.', true);
        } finally {
// after
            announce('Short URL ready in the field. Click or stretch the button right to restore the original.');
            onCreated?.();
        } catch (error) {
            setMode('long');
            announce(error.message, true);
        } finally {
```

`frontend/app/page.jsx` (MODIFY: replace). The page becomes a client component that holds one piece of shared state, a counter that tells the list to reload.

```jsx
'use client';

import { useState } from 'react';
import RecentUrls from '../components/RecentUrls';
import UrlForm from '../components/UrlForm';

export default function Home() {
    // Bumped after each new short URL so RecentUrls reloads.
    const [refreshKey, setRefreshKey] = useState(0);

    return (
        <>
            <h1>Make your <span className="headline-url">URL</span> <span className="headline-shorter">shorter</span> <span className="headline-here">here<span className="headline-arrow" aria-hidden="true">↘</span></span></h1>
            <main>
                <UrlForm onCreated={() => setRefreshKey((key) => key + 1)} />

                <div className="url-list">
                    <h2>Recent URLs</h2>
                    <RecentUrls refreshKey={refreshKey} />
                </div>
            </main>
        </>
    );
}
```

### Step 1.9 — Frontend: list styles

`frontend/css/style.css` (MODIFY: append to the end; uses the existing design tokens)

```css
/* Recent URLs list */
.url-items {
    display: grid;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
}

.url-items:empty {
    display: none;
}

.url-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.25rem 1rem;
    padding: 1rem 1.125rem;
    border: 1px solid var(--line);
    border-radius: 1rem;
    background: var(--paper);
}

.url-item-short {
    font-weight: 600;
}

.url-item-original,
.url-item-meta {
    grid-column: 1;
    color: var(--muted);
    font-size: 0.8125rem;
}

.url-item-original {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.url-item-actions {
    grid-column: 2;
    grid-row: 1 / span 3;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.url-item-actions button {
    padding: 0.5rem 0.875rem;
    border: 1px solid var(--ink);
    border-radius: 0.75rem;
    background: var(--surface);
    color: var(--ink);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
}

.url-item-actions button:hover {
    background: var(--ink);
    color: var(--surface);
}

.url-item-actions button:disabled {
    cursor: wait;
    opacity: 0.65;
}

.url-empty {
    color: var(--muted);
    font-size: 0.875rem;
}

.url-empty:empty {
    display: none;
}

@media (max-width: 560px) {
    .url-item {
        grid-template-columns: minmax(0, 1fr);
    }

    .url-item-actions {
        grid-column: 1;
        grid-row: auto;
        margin-top: 0.5rem;
    }
}
```

### Step 1.10 — API tests

`backend/tests/test_urls.py` (FILL). These tests stay valid through every later phase.

```python
def create(client, url="https://example.com/some/long/path"):
    response = client.post("/api/urls", json={"original_url": url})
    assert response.status_code == 201, response.text
    return response.json()


def test_create_url(client):
    body = create(client)
    assert body["original_url"] == "https://example.com/some/long/path"
    assert body["short_url"].endswith("/" + body["short_code"])
    assert body["click_count"] == 0


def test_rejects_invalid_urls(client):
    for bad in ["not-a-url", "ftp://example.com/file", "", "javascript:alert(1)"]:
        response = client.post("/api/urls", json={"original_url": bad})
        assert response.status_code == 422, bad


def test_list_is_newest_first(client):
    first = create(client, "https://example.com/first")
    second = create(client, "https://example.com/second")
    codes = [u["short_code"] for u in client.get("/api/urls").json()]
    assert codes.index(second["short_code"]) < codes.index(first["short_code"])


def test_redirect_increments_click_count(client):
    code = create(client, "https://example.com/docs")["short_code"]
    response = client.get(f"/{code}", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "https://example.com/docs"

    listed = {u["short_code"]: u for u in client.get("/api/urls?limit=100").json()}
    assert listed[code]["click_count"] == 1


def test_unknown_short_code_returns_404(client):
    response = client.get("/doesNotExist", follow_redirects=False)
    assert response.status_code == 404


def test_delete_url(client):
    code = create(client)["short_code"]
    assert client.delete(f"/api/urls/{code}").status_code == 204
    assert client.get(f"/{code}", follow_redirects=False).status_code == 404
    assert client.delete(f"/api/urls/{code}").status_code == 404
```

### Run and verify

Keep both servers from Phase 0 running (uvicorn and `next dev` both reload automatically). Then:

Working directory `backend/`: `python -m pytest` → **7 passed**.

Manual API test (bash / Git Bash):

```bash
curl -X POST http://localhost:8000/api/urls \
  -H "Content-Type: application/json" \
  -d '{"original_url": "https://docs.docker.com/get-started/"}'

curl http://localhost:8000/api/urls
curl -i http://localhost:8000/<short_code>          # 302 + Location header
curl -i http://localhost:8000/doesNotExist           # 404
curl -i -X DELETE http://localhost:8000/api/urls/<short_code>   # 204
```

PowerShell equivalent for the POST:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/urls -ContentType 'application/json' -Body '{"original_url": "https://docs.docker.com/get-started/"}'
```

Browser test at <http://localhost:3000>:

1. Paste `https://docs.docker.com/get-started/` and click **Shorten it!** The field shows `http://localhost:8000/xxxxxxx` and the item appears under "Recent URLs".
2. Type `abc` and submit. The browser's built-in validation blocks it.
3. Click the short link. A new tab opens on Docker Docs. Switch back and the item shows **1 click**.
4. Click **Copy** and paste somewhere. You get the short URL.
5. Click **Delete**. The item disappears.
6. Stop and restart uvicorn (Ctrl+C, then run it again). **All URLs are gone.** This is the problem Phase 2 solves.

**Expected result:** every endpoint behaves as in the API table, and the UI supports create, list, redirect, click count, copy and delete.

---

## Phase 2 — PostgreSQL Persistence

**Goal:** store URLs in PostgreSQL through SQLAlchemy.
**Why:** the in-memory dict lives inside one process. A restart, crash or redeploy wipes it, and two backend processes would not share it. A database keeps data outside the application process.

### Database model

```text
urls
---------------------------------------------------------------
id            INTEGER       PRIMARY KEY (auto-increment)
short_code    VARCHAR(32)   NOT NULL, UNIQUE, indexed
original_url  VARCHAR(2048) NOT NULL
click_count   INTEGER       NOT NULL, DEFAULT 0
created_at    TIMESTAMPTZ   NOT NULL, DEFAULT now()
```

### Files

| Action | File |
|---|---|
| FILL | `backend/app/db/database.py`, `backend/app/db/models.py` |
| MODIFY | `backend/app/services/url_service.py` (replace), `backend/app/api/urls.py`, `backend/app/main.py`, `backend/tests/conftest.py` |

### Step 2.1 — Run PostgreSQL locally (without Docker)

1. Install **PostgreSQL 16**:
   - Windows/macOS: installer from <https://www.postgresql.org/download/> (remember the `postgres` superuser password).
   - Ubuntu: `sudo apt install postgresql`.
2. Create the application user and database. Open `psql` as the superuser (Windows: "SQL Shell (psql)" from the Start menu; Linux: `sudo -u postgres psql`) and run:

```sql
CREATE USER shortener WITH PASSWORD 'shortener';
CREATE DATABASE shortener OWNER shortener;
```

3. Check the connection:

```bash
psql -h localhost -U shortener -d shortener -c "SELECT version();"
```

`backend/.env` already contains the matching URL from Phase 0:

```dotenv
DATABASE_URL=postgresql+psycopg://shortener:shortener@localhost:5432/shortener
```

URL anatomy: `postgresql+psycopg://` (dialect + driver) `shortener:shortener` (user:password) `@localhost:5432` (**host**:port) `/shortener` (database). Remember the **host** part. It changes in Phase 3 and becomes the key point of Phase 5.

> Shortcut if you cannot install PostgreSQL: `docker run -d --name pg-local -p 5432:5432 -e POSTGRES_USER=shortener -e POSTGRES_PASSWORD=shortener -e POSTGRES_DB=shortener postgres:16-alpine`. This runs ahead of the storyline (Phase 5 explains it), but it behaves like a local install. If you use it, remove it before Phase 5 with `docker rm -f pg-local`.

### Step 2.2 — SQLAlchemy engine and session

`backend/app/db/database.py` (FILL)

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

if not settings.database_url:
    raise RuntimeError(
        "DATABASE_URL is not set. Copy backend/.env.example to backend/.env "
        "or pass it as an environment variable (docker run -e DATABASE_URL=...)."
    )

is_sqlite = settings.database_url.startswith("sqlite")  # used by the tests only

engine = create_engine(
    settings.database_url,
    # Test each pooled connection before use, so the app recovers
    # automatically after the database container restarts.
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if is_sqlite else {"connect_timeout": 3},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: one session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### Step 2.3 — ORM model

`backend/app/db/models.py` (FILL)

```python
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Url(Base):
    __tablename__ = "urls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    short_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    original_url: Mapped[str] = mapped_column(String(2048))
    click_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

`Mapped[str]` (not `Mapped[str | None]`) makes a column `NOT NULL`.

### Step 2.4 — Database-backed service

`backend/app/services/url_service.py` (MODIFY: **replace the whole file**, Phase 2 version). The function names match Phase 1. Each function now takes a `db` session.

```python
import logging

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Url
from app.utils.short_code import generate_short_code

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


def _unique_short_code(db: Session) -> str:
    for _ in range(MAX_ATTEMPTS):
        code = generate_short_code(settings.short_code_length)
        if get_url(db, code) is None:
            return code
    raise RuntimeError("Could not generate a unique short code")


def create_url(db: Session, original_url: str) -> Url:
    url = Url(short_code=_unique_short_code(db), original_url=original_url)
    db.add(url)
    db.commit()
    db.refresh(url)  # load server-generated values (id, created_at)
    logger.info("[DATABASE] Created %s -> %s", url.short_code, url.original_url)
    return url


def list_urls(db: Session, limit: int) -> list[Url]:
    return list(db.scalars(select(Url).order_by(Url.id.desc()).limit(limit)))


def get_url(db: Session, short_code: str) -> Url | None:
    return db.scalar(select(Url).where(Url.short_code == short_code))


def delete_url(db: Session, short_code: str) -> bool:
    url = get_url(db, short_code)
    if url is None:
        return False
    db.delete(url)
    db.commit()
    logger.info("[DATABASE] Deleted %s", short_code)
    return True


def _increment_clicks(db: Session, short_code: str) -> bool:
    # Atomic "click_count = click_count + 1" in SQL: concurrent clicks are never lost.
    result = db.execute(
        update(Url).where(Url.short_code == short_code).values(click_count=Url.click_count + 1)
    )
    db.commit()
    logger.info("[DATABASE] click_count +1: %s", short_code)
    return result.rowcount > 0


def resolve_short_code(db: Session, short_code: str) -> str | None:
    """Return the original URL and count the click, or None if unknown."""
    logger.info("[DATABASE] Query PostgreSQL: %s", short_code)
    url = get_url(db, short_code)
    if url is None:
        return None
    _increment_clicks(db, short_code)
    return url.original_url
```

### Step 2.5 — Inject the session into the routes

`backend/app/api/urls.py` (MODIFY, **final version**). Each route gets `db: Session = Depends(get_db)` and passes it to the service.

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.db.models import Url
from app.schemas.url import UrlCreate, UrlResponse
from app.services import url_service

router = APIRouter(prefix="/api/urls", tags=["urls"])
redirect_router = APIRouter(tags=["redirect"])


def to_response(url: Url) -> UrlResponse:
    return UrlResponse(
        short_code=url.short_code,
        short_url=settings.short_url(url.short_code),
        original_url=url.original_url,
        click_count=url.click_count,
        created_at=url.created_at,
    )


@router.post("", response_model=UrlResponse, status_code=status.HTTP_201_CREATED)
def create_short_url(payload: UrlCreate, db: Session = Depends(get_db)):
    url = url_service.create_url(db, str(payload.original_url))
    return to_response(url)


@router.get("", response_model=list[UrlResponse])
def list_short_urls(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    return [to_response(url) for url in url_service.list_urls(db, limit)]


@router.delete("/{short_code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_short_url(short_code: str, db: Session = Depends(get_db)):
    if not url_service.delete_url(db, short_code):
        raise HTTPException(status_code=404, detail="Short URL not found")


@redirect_router.get("/{short_code}")
def redirect_to_original(short_code: str, db: Session = Depends(get_db)):
    original_url = url_service.resolve_short_code(db, short_code)
    if original_url is None:
        raise HTTPException(status_code=404, detail="Short URL not found")
    # 302 (not 301): browsers must not cache the redirect, otherwise
    # repeat clicks never reach the server (no click count, no cache demo).
    return RedirectResponse(original_url, status_code=status.HTTP_302_FOUND)
```

### Step 2.6 — Create tables on startup

`backend/app/main.py` (MODIFY, **Phase 2 version**: adds `lifespan`)

```python
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.urls import redirect_router, router as urls_router
from app.core.config import settings
from app.db import models  # noqa: F401  (registers the Url model on Base.metadata)
from app.db.database import Base, engine

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creates missing tables; existing tables and data are left untouched.
    # If the database is unreachable, startup fails here, loudly.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(urls_router)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}


# Registered last: "/{short_code}" matches any single-segment path.
app.include_router(redirect_router)
```

### Step 2.7 — Tests use a throwaway SQLite database

The models only use portable column types, so tests can run against a temporary SQLite file. No PostgreSQL is needed in CI or on a teammate's laptop.

`backend/tests/conftest.py` (MODIFY: replace, final version)

```python
import os
from pathlib import Path

import pytest

TEST_DB = Path(__file__).parent / "test.db"

# Must be set BEFORE the app (and its Settings) is imported.
# Real environment variables override backend/.env.
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["REDIS_URL"] = ""  # caching disabled in tests
os.environ["BASE_URL"] = "http://testserver"

from fastapi.testclient import TestClient  # noqa: E402

from app.db.database import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    TEST_DB.unlink(missing_ok=True)
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()  # release the file handle (required on Windows)
    TEST_DB.unlink(missing_ok=True)
```

### Run and verify

Working directory `backend/`:

```bash
python -m pytest                              # 7 passed
uvicorn app.main:app --reload --port 8000     # starts; the "urls" table is created
```

**Checkpoint**

| Action | Expected |
|---|---|
| Create a URL in the UI | Appears in the list. `psql -h localhost -U shortener -d shortener -c "SELECT short_code, original_url, click_count FROM urls;"` shows the row. |
| Stop and restart uvicorn | The URL **is still listed**. |
| Open the short URL | Redirects to the original URL. The uvicorn log shows `[DATABASE] Query PostgreSQL: ...`. |
| Re-run the `SELECT` | `click_count` incremented. |
| Stop PostgreSQL and restart uvicorn | Startup fails with `connection ... failed: Connection refused`. |

> **SEMINAR DEMO CHECKPOINT — Demo 1: "It works on my machine"**
>
> | | |
> |---|---|
> | **Initial state** | The presenter's laptop runs the full app locally: Python 3.12 + venv, Node.js 22 + `node_modules/` (about 50 packages), a local PostgreSQL 16 service, a hand-written `backend/.env`. |
> | **Actions** | 1. Show the list of things a new teammate must install and configure: `python --version`, `node --version`, `psql --version`, `pip install ...`, `npm install`, `CREATE USER/DATABASE ...`, copy `.env`. Point out that Next.js 16 refuses to start on Node.js 18 (*"Node.js version >=20.9.0 is required"*), which is a typical version mismatch between laptops. 2. Simulate a teammate's machine without PostgreSQL: stop the PostgreSQL service (Windows: Services → `postgresql-x64-16` → Stop; macOS: `brew services stop postgresql@16`; Linux: `sudo systemctl stop postgresql`). 3. Restart uvicorn. |
> | **Expected output** | `uvicorn` exits during startup with `psycopg.OperationalError: connection failed: ... Connection refused`. |
> | **Concept** | The app depends on its **environment**: OS, Python **and** Node.js versions, system packages, running services and config files. Every machine is different. Docker packages the app *with* its environment. |
> | **Restore** | Start the PostgreSQL service again and restart uvicorn. |

---

## Phase 3 — Dockerize the FastAPI Backend

**Goal:** the same FastAPI app runs inside a container.
**Why:** an image bundles the OS userland, the Python version, the dependencies and the code, so the app runs the same way on every machine that has Docker.

```text
Dockerfile ──docker build──▶ Image ──docker run──▶ Container
(recipe)                     (read-only template)  (running process + writable layer)
```

### Files

| Action | File |
|---|---|
| FILL | `backend/Dockerfile` |
| NEW | `backend/.dockerignore` |

### Step 3.1 — Dockerfile

`backend/Dockerfile` (FILL)

```dockerfile
# 1. Base image: Debian slim with Python 3.12 preinstalled
FROM python:3.12-slim

# 2. No .pyc files; print logs immediately (needed for `docker logs`)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 3. All following commands run in /app inside the image
WORKDIR /app

# 4. Dependencies first: this layer is cached until requirements.txt changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Application code (changes often, so it goes last)
COPY app ./app

# 6. Documentation only: the app listens on 8000 (does NOT publish the port)
EXPOSE 8000

# 7. Default process. 0.0.0.0 = listen on all interfaces of the container,
#    not only on the container's own loopback.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

| Instruction | Meaning |
|---|---|
| `FROM` | Starting layer. Everything else is stacked on top of it. |
| `ENV` | Environment variables baked into the image. |
| `WORKDIR` | Creates the folder and sets it as the current directory. |
| `COPY src dest` | Copies files from the **build context** (the folder passed to `docker build`) into the image. |
| `RUN` | Executes a command **at build time** and saves the result as a new layer. |
| `EXPOSE` | Metadata only. Publishing a port is done with `docker run -p`. |
| `CMD` | Command executed **when a container starts**. |

> **Why `--host 0.0.0.0`?** By default uvicorn listens on `127.0.0.1`. Inside a container that is the container's own loopback, so traffic forwarded by `-p` from the host never reaches it, and you get "connection reset" or "empty reply".

> **Why copy `requirements.txt` before `app/`?** Docker caches each layer. Editing Python code only rebuilds the final `COPY` layer, which takes seconds. The slow `pip install` layer is reused.

### Step 3.2 — .dockerignore

The **build context** is the whole folder sent to the Docker engine. `.dockerignore` keeps unnecessary or secret files out of it.

`backend/.dockerignore` (NEW)

```gitignore
.venv/
venv/
__pycache__/
*.py[cod]
.pytest_cache/
tests/
*.db
.env
.env.*
Dockerfile
.dockerignore
```

`.env` is excluded on purpose. Configuration is passed at **run time** with `-e`, never baked into the image.

### Step 3.3 — Build, run, inspect, stop

Stop the local uvicorn first (Ctrl+C) so port 8000 is free. Run from the repo root:

```bash
# Build an image from the backend/ build context and tag it
docker build -t url-shortener-backend ./backend

# List images
docker images url-shortener-backend
```

The backend still needs a database. In this phase it is the **PostgreSQL on your host machine** from Phase 2. Inside a container, `localhost` means *the container itself*, so we use Docker Desktop's special name for the host, `host.docker.internal` (Phase 5 explains this properly):

```bash
docker run -d --name backend -p 8000:8000 \
  -e DATABASE_URL=postgresql+psycopg://shortener:shortener@host.docker.internal:5432/shortener \
  -e BASE_URL=http://localhost:8000 \
  url-shortener-backend
```

- Linux only: add `--add-host=host.docker.internal:host-gateway`.
- If you get `Connection refused` or `no pg_hba.conf entry`, your local PostgreSQL rejects non-localhost connections. Either allow it (`listen_addresses = '*'` in `postgresql.conf`, plus a `host all all 0.0.0.0/0 scram-sha-256` line in `pg_hba.conf`, then restart the service), or, to prove only that the container runs, use a throwaway SQLite database: `-e DATABASE_URL=sqlite:///./demo.db`.

```bash
docker ps                          # running containers
docker logs -f backend             # uvicorn output (Ctrl+C stops following, not the container)
docker exec -it backend sh         # shell inside the container: try `ls /app`, `python --version`, `exit`
docker stop backend                # stop (SIGTERM)
docker ps -a                       # stopped containers are still listed
docker rm backend                  # delete the container (the image stays)
```

| Command | What happens | Link in the chain |
|---|---|---|
| `docker build` | Reads the Dockerfile, executes each instruction, stores layers | Dockerfile → **Image** |
| `docker images` | Lists local images (name, tag, ID, size) | Image |
| `docker run` | Creates a writable layer on top of the image and starts `CMD` | Image → **Container** |
| `docker ps` | Lists running containers (`-a` includes stopped ones) | Container |
| `docker stop` | Sends SIGTERM, then SIGKILL after 10 s | Container (stopped, still exists) |
| `docker rm` | Deletes the container and its writable layer | Container removed, image remains |

### Verify

With the container running (run it again after the `rm` above):

| Check | Expected |
|---|---|
| `docker ps` | `backend` is `Up`, `0.0.0.0:8000->8000/tcp` |
| <http://localhost:8000/api/health> | `{"status":"ok"}`, served by the container |
| <http://localhost:3000> (`npm run dev` still running) | Create, list and redirect work against the containerized API |

> **SEMINAR DEMO CHECKPOINT — Demo 2: Image and Container**
>
> | | |
> |---|---|
> | **Initial state** | No `url-shortener-backend` image (`docker rmi url-shortener-backend` if needed). Local uvicorn stopped. |
> | **Actions** | 1. `docker build -t url-shortener-backend ./backend` and point out each Dockerfile step in the output. 2. `docker images`. 3. Change one line in `app/main.py` and rebuild. Only the final layers rebuild; the `pip install` step shows `CACHED`. 4. `docker run ...` (command above). 5. `docker ps`, then open `/api/health`. 6. Run a **second container from the same image**: `docker run -d --name backend2 -p 8001:8000 -e DATABASE_URL=sqlite:///./demo.db url-shortener-backend`, then open `localhost:8001/api/health`. |
> | **Expected output** | Build completes; one image, two independent containers. |
> | **Concept** | An image is a template; a container is a running instance of it. The same image gives the same behavior anywhere. |
> | **Restore** | `docker rm -f backend backend2`, then `docker build --no-cache -t url-shortener-backend ./backend`. |

---

## Phase 4 — Dockerize the Frontend

**Goal:** build the Next.js app inside Docker and serve the result from an Nginx container on `http://localhost:8080`.
**Why this is a good Docker example:** unlike plain HTML files, a Next.js frontend needs a **build toolchain**: the right Node.js version, `npm ci`, about 50 packages in `node_modules/` (some with OS-specific native binaries), and `next build`. In production, though, it is only static files. A **multi-stage Dockerfile** handles both: stage 1 has Node.js and builds, stage 2 has only Nginx and the built files. Nobody needs Node.js installed to build or run the frontend, and the final image contains no Node.js at all.
**Why Nginx:** it is a small, fast, production-grade web server. It serves static files directly and can also act as a **reverse proxy**, forwarding `/api/*` and short codes to the backend. That gives the browser one origin. Production builds call the API with an empty base URL (`/api/urls`), so no CORS is needed.

### Files

| Action | File |
|---|---|
| FILL | `frontend/nginx.conf`, `frontend/Dockerfile` |
| NEW | `frontend/.dockerignore` |

### Step 4.1 — Nginx configuration

`frontend/nginx.conf` (FILL, final version)

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Docker's embedded DNS server (available on user-defined networks).
    # Resolving "backend" per request instead of at startup lets Nginx start
    # even when the backend container does not exist yet. Requests then
    # return 502 instead of the whole container crashing.
    resolver 127.0.0.11 valid=10s ipv6=off;
    resolver_timeout 3s;
    set $backend_upstream http://backend:8000;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Static files. Anything that is not a file (e.g. /aB3dE9x) is a short code.
    location / {
        try_files $uri $uri/ @backend;
    }

    # REST API
    location /api/ {
        proxy_pass $backend_upstream;
    }

    # Short-code redirects (and FastAPI's /docs, /openapi.json)
    location @backend {
        proxy_pass $backend_upstream;
    }
}
```

| Request | Matched by | Result |
|---|---|---|
| `GET /` | `location /` → `$uri/` → `index.html` | Static page (exported by `next build`) |
| `GET /_next/static/chunks/….js` | `location /` → `$uri` | Static file (React bundle, CSS) |
| `GET /api/urls` | `location /api/` | Proxied to `http://backend:8000/api/urls` |
| `GET /aB3dE9x` | `location /` → no file → `@backend` | Proxied to FastAPI → 302 |

`backend` is a **container name / Compose service name**, not an IP address. Phase 5 makes it resolvable.

### Step 4.2 — Multi-stage Dockerfile

`frontend/Dockerfile` (FILL)

```dockerfile
# ---------- Stage 1: build (Node.js + node_modules, discarded afterwards) ----------
FROM node:22-alpine AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Dependencies first: this layer is cached until package*.json changes.
# `npm ci` installs exactly what package-lock.json says (Linux binaries).
COPY package.json package-lock.json ./
RUN npm ci

# Source code, then `next build` -> static export in /app/out
COPY . .
RUN npm run build

# ---------- Stage 2: runtime (only Nginx + the built files) ----------
FROM nginx:1.27-alpine

# Replace the default site with ours
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Take ONLY the build output from stage 1
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80
# CMD is inherited from the nginx image: nginx -g 'daemon off;'
```

| Instruction | Meaning |
|---|---|
| `FROM … AS build` | Names a stage. A Dockerfile can have several `FROM` lines, and each starts a fresh stage. |
| `npm ci` | Clean, reproducible install from `package-lock.json` (unlike `npm install`, it never changes the lock file). |
| `COPY --from=build` | Copies files **from an earlier stage**, not from the build context. Everything else in stage 1 (Node.js, `node_modules`, the source code) is left behind. |
| Last `FROM` | Only the last stage becomes the image you run. |

`frontend/.dockerignore` (NEW)

```gitignore
node_modules/
.next/
out/
.env*
Dockerfile
.dockerignore
```

- **`node_modules/`** is the important line. It is the largest folder in the repo, and if you installed it on Windows or macOS it holds native binaries for *your* OS (for example `@next/swc-win32-x64-msvc`). Copying it into a Linux image would be slow and break the build. `npm ci` inside the container installs the Linux versions.
- **`.env*`** keeps `.env.development` (the `localhost:8000` API URL) out of the image. A production `next build` would ignore it anyway; excluding it makes that explicit.

> **SEMINAR DEMO CHECKPOINT — Bonus: Multi-stage build**
>
> | | |
> |---|---|
> | **Initial state** | No frontend images (`docker rmi url-shortener-frontend url-shortener-frontend:build` if needed). |
> | **Actions** (repo root) | 1. `docker build --target build -t url-shortener-frontend:build ./frontend` builds **only stage 1**. 2. `docker build -t url-shortener-frontend ./frontend` builds the full image (stage 1 is reused from cache). 3. `docker images url-shortener-frontend` and compare the sizes. 4. `docker run --rm url-shortener-frontend node --version` fails: there is no Node.js in the final image. 5. Temporarily rename `.dockerignore` and rebuild. The first output line `transferring context:` jumps from kilobytes to hundreds of megabytes. Rename it back. |
> | **Expected output** | Step 3: the `build` tag is several hundred MB; the final `latest` image is about 50 MB (Nginx Alpine plus well under 1 MB of static files). Step 4: `exec: "node": executable file not found`. |
> | **Concept** | Build-time dependencies stay in a throwaway stage; the runtime image contains only what production needs. The Node.js toolchain lives in the Dockerfile, not on each laptop. |
> | **Restore** | `docker rmi url-shortener-frontend:build`, and make sure `frontend/.dockerignore` exists again. |

### Step 4.3 — Host port vs container port

```text
Browser ──▶ localhost:8080 ──▶ Host port 8080 ──(-p 8080:80)──▶ Container port 80 ──▶ Nginx
```

`-p HOST:CONTAINER`. Nginx listens on **80 inside** its container. We pick **8080 on the host** (any free port works). Without `-p`, the container is reachable only from other containers, never from the host.

> **SEMINAR DEMO CHECKPOINT — Demo 3: Port Mapping**
>
> | | |
> |---|---|
> | **Initial state** | No `frontend` container. Stop `npm run dev` from Phase 0 (Ctrl+C). |
> | **Actions** (repo root) | 1. `docker build -t url-shortener-frontend ./frontend` (multi-stage, see above) 2. Run **without** `-p`: `docker run -d --name frontend url-shortener-frontend` 3. `docker ps` shows `80/tcp` and no `0.0.0.0:` mapping. 4. Open <http://localhost:8080>: fails. 5. Prove Nginx *is* running inside: `docker exec frontend wget -qO- http://127.0.0.1/` prints the HTML. 6. `docker rm -f frontend` 7. Run **with** `-p`: `docker run -d --name frontend -p 8080:80 url-shortener-frontend` 8. `docker ps` shows `0.0.0.0:8080->80/tcp`. Open <http://localhost:8080>: the page loads. |
> | **Expected output** | Step 4: "This site can't be reached". Step 8: the styled page. |
> | **Concept** | Containers have an isolated network namespace. `-p` publishes a container port on the host. |
> | **Restore** | `docker rm -f frontend`, then repeat step 7. |

### Verify

| Check | Expected |
|---|---|
| <http://localhost:8080> | The page with full styling loads (the Next.js static export served by Nginx) |
| "Recent URLs" section | Shows *"The service responded with an error (502)…"* |
| `docker logs frontend` | `backend could not be resolved` |

**Expected result:** the frontend is accessible from the host browser. The API does not work **yet**, by design. The `frontend` container is on Docker's *default* bridge network, which has no name resolution, and there is no container named `backend` that it can reach. Phase 5 fixes this.

---

## Phase 5 — PostgreSQL Container and Docker Networking

**Goal:** move PostgreSQL into a container and connect frontend → backend → postgres through a user-defined Docker network.
**Why:** no local PostgreSQL install, an identical database version for everyone, and an introduction to how containers find each other.

### Concepts

- **Official image `postgres:16-alpine`.** On first start it initializes a database using `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`.
- **Docker network.** A virtual switch. Containers on the same **user-defined** network can reach each other.
- **Docker DNS.** On a user-defined network, Docker runs an embedded DNS server (`127.0.0.11`) that resolves **container names** (and, in Compose, service names) to their current IP. IPs change on every restart, but names do not.
- The **default** `bridge` network (used when you omit `--network`) does **not** offer name resolution. That is why Phase 4 failed.

### Why `localhost` is wrong inside a container

```text
┌──────────── backend container ────────────┐      ┌──── postgres container ────┐
│  DATABASE_URL=...@localhost:5432/...      │      │  PostgreSQL :5432          │
│        │                                  │      │                            │
│        └──▶ localhost = THIS container ✗  │      │                            │
│             (nothing listens on 5432)     │      │                            │
│                                           │      │                            │
│  DATABASE_URL=...@postgres:5432/...       │      │                            │
│        └──▶ Docker DNS: postgres ─────────┼─────▶│ 172.18.0.2:5432  ✓         │
└───────────────────────────────────────────┘      └────────────────────────────┘
                    └──────────── network: url-shortener-net ──────────┘
```

Each container has its **own** `localhost`. To reach another container, use **its name**.

### Commands

Clean up containers from Phases 3–4 and stop the local PostgreSQL service if it is running. Run from the repo root:

```bash
docker rm -f backend frontend

# 1. Create a user-defined network
docker network create url-shortener-net
docker network ls

# 2. Start PostgreSQL on that network (no -p: only containers need to reach it)
docker run -d --name postgres --network url-shortener-net \
  -e POSTGRES_USER=shortener \
  -e POSTGRES_PASSWORD=shortener \
  -e POSTGRES_DB=shortener \
  postgres:16-alpine

# Wait until the log says "database system is ready to accept connections"
docker logs -f postgres
```

> **SEMINAR DEMO CHECKPOINT — Demo 4: Docker Network**
>
> | | |
> |---|---|
> | **Initial state** | Network `url-shortener-net` and container `postgres` running (commands above). No `backend` container. |
> | **Action 1: wrong host** | `docker run -d --name backend --network url-shortener-net -p 8000:8000 -e DATABASE_URL=postgresql+psycopg://shortener:shortener@localhost:5432/shortener -e BASE_URL=http://localhost:8080 url-shortener-backend` |
> | **Expected** | `docker ps -a` shows `backend Exited (3)`. `docker logs backend` shows `connection failed: ... port 5432 failed: Connection refused`, because `localhost` is the backend container itself. |
> | **Action 2 (optional): right name, wrong network** | `docker rm backend`, then the same command but with `@postgres:5432` and **without** `--network`. Logs show `failed to resolve host 'postgres'`: the default bridge has no DNS. |
> | **Action 3: fix** | `docker rm backend`, then: `docker run -d --name backend --network url-shortener-net -p 8000:8000 -e DATABASE_URL=postgresql+psycopg://shortener:shortener@postgres:5432/shortener -e BASE_URL=http://localhost:8080 url-shortener-backend` |
> | **Expected** | `docker logs backend` shows `Application startup complete.` |
> | **Concept** | Containers communicate over a user-defined network, by **name** through Docker DNS. Never use `localhost` or hard-coded IPs. |
> | **Restore** | `docker rm -f backend postgres`, `docker network rm url-shortener-net`, then start again from step 1. |

Start the frontend on the same network. Its Nginx config already points to `backend:8000`:

```bash
docker run -d --name frontend --network url-shortener-net -p 8080:80 url-shortener-frontend
```

`BASE_URL=http://localhost:8080` makes short links go through Nginx, which forwards them to the backend.

### Inspect the network

```bash
docker network inspect url-shortener-net
# "Containers": postgres, backend, frontend, each with an IPv4Address

# Ask Docker DNS from inside the backend container
docker exec backend python -c "import socket; print(socket.gethostbyname('postgres'))"
# e.g. 172.18.0.2

# Query the database inside the postgres container
docker exec -it postgres psql -U shortener -d shortener -c "SELECT short_code, original_url, click_count FROM urls;"
```

### Verify

**Checkpoint**

```text
Browser → localhost:8080 → frontend (Nginx)
                               │  Docker network: url-shortener-net
                               ▼
                           backend (FastAPI)
                               │
                               ▼
                           postgres (PostgreSQL)
```

| Check | Expected |
|---|---|
| <http://localhost:8080> | The list loads (empty) with no error |
| Create a URL | Short link looks like `http://localhost:8080/xxxxxxx` |
| Click it | Redirect works and the click count increases |
| `psql` query above | Shows the row |

---

## Phase 6 — Docker Volume

**Goal:** PostgreSQL data survives container removal.
**Why:** a container's writable layer is deleted with the container. Databases need storage with an independent lifecycle.

### Concepts

| Term | Meaning |
|---|---|
| Container filesystem | Image layers (read-only) + a writable layer that **dies with the container** |
| Volume | Storage managed by Docker, outside any container's lifecycle |
| Named volume | A volume with a name you choose (`url-shortener-pgdata`), easy to reuse |
| Anonymous volume | A volume with a random ID. The `postgres` image declares `VOLUME /var/lib/postgresql/data`, so Docker creates one automatically when you don't mount anything. A **new** container gets a **new** anonymous volume. |
| PostgreSQL data directory | `/var/lib/postgresql/data` (for the `postgres:16` image) |

> **SEMINAR DEMO CHECKPOINT — Demo 5: Volume (important)**
>
> **Part A: without a volume, data is lost**
>
> | | |
> |---|---|
> | **Initial state** | The Phase 5 setup is running (`postgres` without `-v`, `backend`, `frontend`). |
> | **Actions** | 1. Create 2 URLs at <http://localhost:8080>. 2. `docker rm -f postgres` 3. Recreate it with the **same** command: `docker run -d --name postgres --network url-shortener-net -e POSTGRES_USER=shortener -e POSTGRES_PASSWORD=shortener -e POSTGRES_DB=shortener postgres:16-alpine` 4. Wait for "ready to accept connections", then `docker restart backend` (so the backend recreates the empty `urls` table at startup). 5. Reload the page. |
> | **Expected output** | "No URLs yet." All data is gone. |
> | **Why** | The data lived in an anonymous volume attached to the old container. The new container got a fresh, empty one. (`docker volume ls` shows the orphaned volume; `docker volume prune` removes it.) |
>
> **Part B: with a named volume, data persists**
>
> | | |
> |---|---|
> | **Actions** | 1. `docker rm -f postgres` 2. `docker volume create url-shortener-pgdata` 3. Start PostgreSQL **with** the volume: `docker run -d --name postgres --network url-shortener-net -e POSTGRES_USER=shortener -e POSTGRES_PASSWORD=shortener -e POSTGRES_DB=shortener -v url-shortener-pgdata:/var/lib/postgresql/data postgres:16-alpine` 4. Wait for ready, then `docker restart backend`. 5. Create 2 URLs and click one. 6. `docker rm -f postgres` (the container is gone) 7. Run the **same** command from step 3 again. 8. Wait for ready, then reload the page. |
> | **Expected output** | Both URLs are still listed with the same click counts. The postgres log says `Skipping initialization` because the data directory is already populated. |
> | **Concept** | Volumes decouple **data lifecycle** from **container lifecycle**. Containers are disposable; volumes are not. |
> | **Restore** | `docker rm -f postgres`, `docker volume rm url-shortener-pgdata`, then repeat Part B. |

Useful commands:

```bash
docker volume ls
docker volume inspect url-shortener-pgdata     # "Mountpoint": where Docker stores it
docker volume rm url-shortener-pgdata          # deletes the data (container must be removed first)
```

> Step 4 of each part (`docker restart backend`) is needed only because the schema is created at backend startup. In Phase 7, `init.sql` creates the schema when the database is first initialized.

**Expected result:** data survives `docker rm` + `docker run` of the PostgreSQL container.

---

## Phase 7 — Docker Compose

**Goal:** describe the whole system in one file and start it with one command.
**Why:** by now, starting the system takes this:

```bash
docker network create url-shortener-net
docker volume create url-shortener-pgdata
docker build -t url-shortener-backend ./backend
docker build -t url-shortener-frontend ./frontend
docker run -d --name postgres --network url-shortener-net -e POSTGRES_USER=... -e POSTGRES_PASSWORD=... -e POSTGRES_DB=... -v url-shortener-pgdata:/var/lib/postgresql/data postgres:16-alpine
# ...wait for postgres...
docker run -d --name backend --network url-shortener-net -p 8000:8000 -e DATABASE_URL=... -e BASE_URL=... url-shortener-backend
docker run -d --name frontend --network url-shortener-net -p 8080:80 url-shortener-frontend
```

That is seven commands, which must run in the right order with matching names, plus a teardown sequence. It is error-prone and lives only in people's heads. Compose turns it into **declarative, version-controlled configuration**.

### Files

| Action | File |
|---|---|
| FILL | `compose.yaml`, `.env.example`, `docker/postgres/init.sql` |

### Step 7.1 — Clean up manual resources

Run from the repo root:

```bash
docker rm -f frontend backend postgres
docker network rm url-shortener-net
docker volume rm url-shortener-pgdata
```

### Step 7.2 — Database init script

The official image runs every `*.sql` file in `/docker-entrypoint-initdb.d/` **once**, only when the data directory is empty, which means on the first start of a new volume.

`docker/postgres/init.sql` (FILL)

```sql
-- Runs only when the PostgreSQL data volume is empty (first start).
-- Must stay in sync with backend/app/db/models.py.
CREATE TABLE IF NOT EXISTS urls (
    id           SERIAL PRIMARY KEY,
    short_code   VARCHAR(32)   NOT NULL UNIQUE,
    original_url VARCHAR(2048) NOT NULL,
    click_count  INTEGER       NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Stable demo entry: http://localhost:8080/docker (used in the Redis demo)
INSERT INTO urls (short_code, original_url)
VALUES ('docker', 'https://docs.docker.com/')
ON CONFLICT (short_code) DO NOTHING;
```

The backend's `create_all` still runs at startup. It sees the table exists and does nothing.

### Step 7.3 — Root environment example

`.env.example` (FILL). Used by **Docker Compose** (repo root). Copying it is optional: `compose.yaml` has safe local defaults.

```dotenv
# Docker Compose settings. Optional: copy to .env (never commit .env) to override defaults.

# PostgreSQL container credentials (local development only)
POSTGRES_USER=shortener
POSTGRES_PASSWORD=change-me
POSTGRES_DB=shortener

# Host ports
FRONTEND_PORT=8080
BACKEND_PORT=8000

# Public origin for short links. Must match FRONTEND_PORT.
BASE_URL=http://localhost:8080

# Redis cache entry lifetime (Phase 8+)
CACHE_TTL_SECONDS=3600
```

> ⚠️ If you change `POSTGRES_PASSWORD` **after** the volume was created, PostgreSQL keeps the old password (initialization only runs once). Run `docker compose down -v` to start fresh.

### Step 7.4 — compose.yaml

`compose.yaml` (FILL, **Phase 7 version**)

```yaml
name: url-shortener

services:
  frontend:
    build: ./frontend
    image: url-shortener-frontend
    ports:
      - "${FRONTEND_PORT:-8080}:80"
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - shortener-net

  backend:
    build: ./backend
    image: url-shortener-backend
    env_file:
      - path: .env
        required: false
    environment:
      # "postgres" is the service name below, resolved by Docker DNS
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-shortener}:${POSTGRES_PASSWORD:-shortener}@postgres:5432/${POSTGRES_DB:-shortener}
      BASE_URL: ${BASE_URL:-http://localhost:8080}
    ports:
      - "${BACKEND_PORT:-8000}:8000"   # optional: direct access to /docs
    depends_on:
      - postgres
    restart: unless-stopped
    networks:
      - shortener-net

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-shortener}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-shortener}
      POSTGRES_DB: ${POSTGRES_DB:-shortener}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    restart: unless-stopped
    networks:
      - shortener-net
    # No "ports": the database is reachable only from inside the network.

volumes:
  pgdata:

networks:
  shortener-net:
```

| Section | Meaning here |
|---|---|
| `name` | Project name: prefixes resources (`url-shortener-backend-1`, `url-shortener_pgdata`, `url-shortener_shortener-net`). |
| `services` | One entry per container. **The service name is also its DNS name** (`backend`, `postgres`). |
| `build` | Build context folder. Compose runs `docker build` for you. |
| `image` | Tag for the built image (with `build`), or an image to pull (without `build`, e.g. `postgres:16-alpine`). |
| `ports` | `"HOST:CONTAINER"`, the same as `-p`. |
| `environment` | Variables set in the container. `${VAR:-default}` is substituted from the shell or the root `.env`, falling back to the default. |
| `env_file` | Loads every variable from a file into the container. `required: false` makes it optional (Compose 2.24+). `environment` wins when both define the same variable. |
| `volumes` (service) | `pgdata:/path` = **named volume**; `./file:/path:ro` = **bind mount** of a host file (read-only). |
| `volumes` (top level) | Declares named volumes. Compose creates them if missing. |
| `networks` | Declares a user-defined network and attaches services to it (same as `--network`). |
| `depends_on` | **Start order only.** It does *not* wait until PostgreSQL accepts connections (see Phase 9). |
| `restart` | Restart policy. `unless-stopped` restarts after crashes, which also covers the startup race described below. |

> The default credentials (`shortener`) are for local demos only. They are not real secrets. For a real deployment, require the variable instead (`${POSTGRES_PASSWORD:?set it in .env}`) or use Docker secrets.

### Run

Working directory: repo root

```bash
docker compose up --build        # build images, create network + volume, start everything (logs in foreground)
# or detached:
docker compose up --build -d
docker compose ps
docker compose logs -f backend
docker compose down              # stop and remove containers + network (volume is KEPT)
docker compose down -v           # ...and delete the volume (all data)
```

> You may see the backend exit once and restart on the very first `up`. PostgreSQL is still initializing when the backend tries to connect. `restart: unless-stopped` papers over this; **Phase 9 solves it properly.**

> **SEMINAR DEMO CHECKPOINT — Demo 6: Docker Compose**
>
> | | |
> |---|---|
> | **Initial state** | No project containers (`docker compose down -v`). Show the 7 manual commands above on a slide. |
> | **Actions** | 1. `docker compose up --build -d` 2. `docker compose ps` shows 3 services `running`. 3. Open <http://localhost:8080>: the `docker` demo entry from `init.sql` is listed. Create a URL. 4. `docker compose down`, then `docker compose up -d`. The URL is still there (volume). 5. `docker volume ls` and `docker network ls` show the resources Compose created. |
> | **Expected output** | One command replaces the whole manual sequence; data survives `down`/`up`. |
> | **Concept** | Infrastructure as code: services, network, volume and config in one reviewed file. |
> | **Restore** | `docker compose down -v`, then `docker compose up --build -d`. |

### Verify

**Checkpoint:** from a fresh clone, `docker compose up --build` starts the application with no local PostgreSQL, no Python and no Node.js installed. The first build takes longer, because `npm ci` and `next build` run inside the frontend build stage; later builds reuse the cached layers.

| Check | Expected |
|---|---|
| `docker compose ps` | `frontend`, `backend`, `postgres` all running |
| <http://localhost:8080> | UI works, `docker` entry listed |
| <http://localhost:8080/docker> | Redirects to Docker Docs |
| <http://localhost:8000/docs> | Swagger UI |
| `docker compose exec postgres psql -U shortener -d shortener -c "SELECT * FROM urls;"` | Rows present |

---

## Phase 8 — Redis Cache

**Goal:** cache short code → original URL lookups in Redis.
**Why:** redirects are the hot path (read-heavy, rarely changing). Redis keeps data in memory, so a lookup is a sub-millisecond `GET` with no SQL query or table index lookup. It also shows how adding a new service is just a few lines of Compose.

### Redirect flow

```text
GET /{short_code}
        │
        ▼
   Check Redis  (key: url:{short_code})
        │
   ┌────┴────┐
   │         │
  HIT       MISS
   │         │
   │         ▼
   │    PostgreSQL SELECT
   │         │
   │         ▼
   │    Store in Redis (TTL)
   │         │
   └────┬────┘
        ▼
  UPDATE click_count + 1   (PostgreSQL, atomic)
        ▼
     302 Redirect
```

> Honest note for the audience: the click counter is still written to PostgreSQL on every redirect, because counts must be durable. The cache removes the **read** (`SELECT`). Counting clicks in Redis and flushing them periodically is possible but out of scope.

### Files

| Action | File |
|---|---|
| FILL | `backend/app/services/cache_service.py` |
| MODIFY | `backend/app/services/url_service.py`, `compose.yaml` |

### Step 8.1 — Cache service

`backend/app/services/cache_service.py` (FILL)

```python
import logging

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# The client connects lazily on first use. Short timeouts keep redirects fast
# when Redis is down. In that case we fall back to PostgreSQL.
_client = (
    redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    if settings.redis_url
    else None
)


def _key(short_code: str) -> str:
    return f"url:{short_code}"


def get_cached_url(short_code: str) -> str | None:
    if _client is None:
        return None
    try:
        value = _client.get(_key(short_code))
    except redis.RedisError as exc:
        logger.warning("[REDIS] Unavailable (%s), falling back to PostgreSQL", exc)
        return None
    if value is None:
        logger.info("[REDIS] Cache MISS: %s", short_code)
    else:
        logger.info("[REDIS] Cache HIT: %s", short_code)
    return value


def cache_url(short_code: str, original_url: str) -> None:
    if _client is None:
        return
    try:
        _client.set(_key(short_code), original_url, ex=settings.cache_ttl_seconds)
        logger.info("[REDIS] Cached: %s (TTL %ss)", short_code, settings.cache_ttl_seconds)
    except redis.RedisError as exc:
        logger.warning("[REDIS] Could not cache %s (%s)", short_code, exc)


def delete_cached_url(short_code: str) -> None:
    if _client is None:
        return
    try:
        _client.delete(_key(short_code))
        logger.info("[REDIS] Invalidated: %s", short_code)
    except redis.RedisError as exc:
        logger.warning("[REDIS] Could not invalidate %s (%s)", short_code, exc)


def status() -> str:
    """'ok', 'error', or 'disabled'. Used by /api/health (Phase 9)."""
    if _client is None:
        return "disabled"
    try:
        _client.ping()
        return "ok"
    except redis.RedisError:
        return "error"
```

### Step 8.2 — Use the cache in the service

`backend/app/services/url_service.py` (MODIFY, **final version**). Changes compared with Phase 2: the `cache_service` import, invalidation in `delete_url()`, and a cache-first `resolve_short_code()`.

```python
import logging

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Url
from app.services import cache_service
from app.utils.short_code import generate_short_code

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


def _unique_short_code(db: Session) -> str:
    for _ in range(MAX_ATTEMPTS):
        code = generate_short_code(settings.short_code_length)
        if get_url(db, code) is None:
            return code
    raise RuntimeError("Could not generate a unique short code")


def create_url(db: Session, original_url: str) -> Url:
    url = Url(short_code=_unique_short_code(db), original_url=original_url)
    db.add(url)
    db.commit()
    db.refresh(url)  # load server-generated values (id, created_at)
    logger.info("[DATABASE] Created %s -> %s", url.short_code, url.original_url)
    return url


def list_urls(db: Session, limit: int) -> list[Url]:
    return list(db.scalars(select(Url).order_by(Url.id.desc()).limit(limit)))


def get_url(db: Session, short_code: str) -> Url | None:
    return db.scalar(select(Url).where(Url.short_code == short_code))


def delete_url(db: Session, short_code: str) -> bool:
    url = get_url(db, short_code)
    if url is None:
        return False
    db.delete(url)
    db.commit()
    logger.info("[DATABASE] Deleted %s", short_code)
    # Cache invalidation: without this, the deleted link would keep
    # redirecting from Redis until the TTL expires.
    cache_service.delete_cached_url(short_code)
    return True


def _increment_clicks(db: Session, short_code: str) -> bool:
    # Atomic "click_count = click_count + 1" in SQL: concurrent clicks are never lost.
    result = db.execute(
        update(Url).where(Url.short_code == short_code).values(click_count=Url.click_count + 1)
    )
    db.commit()
    logger.info("[DATABASE] click_count +1: %s", short_code)
    return result.rowcount > 0


def resolve_short_code(db: Session, short_code: str) -> str | None:
    """Return the original URL and count the click, or None if unknown."""
    cached_url = cache_service.get_cached_url(short_code)
    if cached_url is not None:
        if _increment_clicks(db, short_code):
            return cached_url
        # Row no longer exists (e.g. invalidation failed): drop the stale entry.
        cache_service.delete_cached_url(short_code)
        return None

    logger.info("[DATABASE] Query PostgreSQL: %s", short_code)
    url = get_url(db, short_code)
    if url is None:
        return None
    _increment_clicks(db, short_code)
    cache_service.cache_url(short_code, url.original_url)
    return url.original_url
```

**Cache invalidation rules**

| Event | Action |
|---|---|
| URL deleted | `delete_cached_url()` right after the DB commit |
| URL changed (if an edit endpoint is ever added) | Call `delete_cached_url()` after the update, and the next redirect re-caches it |
| Anything missed | The TTL (`CACHE_TTL_SECONDS`, default 1 h) expires the entry automatically. A HIT on a deleted row also removes the stale entry. |

### Step 8.3 — Add Redis to Compose

`compose.yaml` (MODIFY). Add `REDIS_URL` and the `redis` dependency to `backend`, and add a `redis` service:

```yaml
  backend:
    # ...unchanged...
    environment:
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-shortener}:${POSTGRES_PASSWORD:-shortener}@postgres:5432/${POSTGRES_DB:-shortener}
      REDIS_URL: redis://redis:6379/0          # NEW: "redis" = service name
      BASE_URL: ${BASE_URL:-http://localhost:8080}
    depends_on:
      - postgres
      - redis                                 # NEW

  # NEW service
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    networks:
      - shortener-net
    # No volume on purpose: a cache can always be rebuilt from PostgreSQL.
```

(Phase 9 shows the complete final file.)

### Run

Working directory: repo root

```bash
docker compose up --build -d
docker compose logs -f backend
```

> **SEMINAR DEMO CHECKPOINT — Demo 7: Redis**
>
> | | |
> |---|---|
> | **Initial state** | Stack running with Redis. Empty cache: `docker compose exec redis redis-cli FLUSHALL`. Terminal A: `docker compose logs -f backend`. |
> | **Actions** (terminal B) | 1. `curl -i http://localhost:8080/docker` (PowerShell: `curl.exe -i ...`) 2. Run the same command again. 3. Inspect the cache: `docker compose exec redis redis-cli KEYS "url:*"` and `docker compose exec redis redis-cli TTL url:docker` 4. Delete a URL in the UI and watch `[REDIS] Invalidated: ...`. |
> | **Expected output** | First request: |
>
> ```text
> backend-1  | INFO:     [REDIS] Cache MISS: docker
> backend-1  | INFO:     [DATABASE] Query PostgreSQL: docker
> backend-1  | INFO:     [DATABASE] click_count +1: docker
> backend-1  | INFO:     [REDIS] Cached: docker (TTL 3600s)
> backend-1  | INFO:     172.19.0.5:48812 - "GET /docker HTTP/1.1" 302 Found
> ```
>
> Second request:
>
> ```text
> backend-1  | INFO:     [REDIS] Cache HIT: docker
> backend-1  | INFO:     [DATABASE] click_count +1: docker
> backend-1  | INFO:     172.19.0.5:48812 - "GET /docker HTTP/1.1" 302 Found
> ```
>
> | | |
> |---|---|
> | **Concept** | Cache-aside pattern; adding a service to a Compose app; service-name DNS (`redis://redis:6379`). |
> | **Bonus** | `docker compose stop redis`, then request again: `[REDIS] Unavailable ..., falling back to PostgreSQL` and the redirect still works. `docker compose start redis` restores it. |
> | **Restore** | `docker compose exec redis redis-cli FLUSHALL` (or `docker compose restart redis`). |

> If the browser shows no new log line on a second click, it may have reused the previous response. Use `curl` for the demo; it never caches.

**Checkpoint**

```text
First redirect   → Cache MISS → PostgreSQL
Second redirect  → Cache HIT  → Redis
```

---

## Phase 9 — Health Checks and Startup Reliability

**Goal:** Docker knows when each service is **ready**, and services start only when their dependencies are ready.
**Why:**

| "Container is running" | "Application is ready" |
|---|---|
| The main process exists. | The process can actually serve requests. |
| PostgreSQL: the server process started, but it may still be initializing the data directory and running `init.sql`. | PostgreSQL accepts TCP connections. |
| Backend: uvicorn is alive, but the database may be unreachable. | `/api/health` confirms the database answers `SELECT 1`. |

`depends_on: [postgres]` only waits for "running". That is why Phase 7 sometimes showed a backend crash and restart on the first start.

### Files

| Action | File |
|---|---|
| MODIFY | `backend/app/main.py` (health endpoint checks DB + Redis), `compose.yaml` (health checks + conditions) |

### Step 9.1 — A real health endpoint

`backend/app/main.py` (MODIFY, **final version**)

```python
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.urls import redirect_router, router as urls_router
from app.core.config import settings
from app.db import models  # noqa: F401  (registers the Url model on Base.metadata)
from app.db.database import Base, engine, get_db
from app.services import cache_service

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creates missing tables; existing tables and data are left untouched.
    # If the database is unreachable, startup fails here, loudly.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(urls_router)


@app.get("/api/health", tags=["health"])
def health(response: Response, db: Session = Depends(get_db)):
    """Readiness check used by Docker.

    - database down → 503 "error" (the app cannot work)
    - redis down    → 200 "degraded" (redirects fall back to PostgreSQL)
    """
    checks = {"database": "ok", "redis": cache_service.status()}
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        checks["database"] = "error"

    if checks["database"] == "error":
        response.status_code = 503
        overall = "error"
    elif checks["redis"] == "error":
        overall = "degraded"
    else:
        overall = "ok"
    return {"status": overall, **checks}


# Registered last: "/{short_code}" matches any single-segment path.
app.include_router(redirect_router)
```

Example responses:

```json
{"status": "ok", "database": "ok", "redis": "ok"}
{"status": "degraded", "database": "ok", "redis": "error"}
{"status": "error", "database": "error", "redis": "ok"}        // HTTP 503
```

The existing `test_health` still passes: in tests Redis is `"disabled"` and the overall status is `"ok"`.

### Step 9.2 — Final compose.yaml

`compose.yaml` (MODIFY, **final version**)

```yaml
name: url-shortener

services:
  frontend:
    build: ./frontend
    image: url-shortener-frontend
    ports:
      - "${FRONTEND_PORT:-8080}:80"
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1/"]
      interval: 10s
      timeout: 3s
      retries: 3
    restart: unless-stopped
    networks:
      - shortener-net

  backend:
    build: ./backend
    image: url-shortener-backend
    env_file:
      - path: .env
        required: false
    environment:
      # Service names ("postgres", "redis") are resolved by Docker DNS
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-shortener}:${POSTGRES_PASSWORD:-shortener}@postgres:5432/${POSTGRES_DB:-shortener}
      REDIS_URL: redis://redis:6379/0
      BASE_URL: ${BASE_URL:-http://localhost:8080}
    ports:
      - "${BACKEND_PORT:-8000}:8000"   # optional: direct access to /docs
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      # python:3.12-slim has no curl; urlopen raises on 503, so the check fails
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 15s
    restart: unless-stopped
    networks:
      - shortener-net

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-shortener}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-shortener}
      POSTGRES_DB: ${POSTGRES_DB:-shortener}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      # -h 127.0.0.1 forces TCP: during first-time init PostgreSQL listens only on
      # a Unix socket, so this stays "unhealthy" until init.sql has finished.
      # $$ escapes $ so the variable is expanded inside the container.
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    restart: unless-stopped
    networks:
      - shortener-net

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    networks:
      - shortener-net
    # No volume on purpose: a cache can always be rebuilt from PostgreSQL.

volumes:
  pgdata:

networks:
  shortener-net:
```

| Field | Meaning |
|---|---|
| `test` | Command run **inside** the container. Exit code 0 means healthy. |
| `interval` / `timeout` | How often to run the check, and how long one check may take. |
| `retries` | Consecutive failures before the container is marked `unhealthy`. |
| `start_period` | Grace period during which failures don't count. |
| `condition: service_healthy` | Wait until the dependency is **healthy**, not merely started. |

Startup order is now `postgres` + `redis` healthy → `backend` starts → `backend` healthy → `frontend` starts.

> Docker (without Swarm or Kubernetes) does **not** restart a container just because it is `unhealthy`. `restart:` reacts only to the process exiting. Health status drives `depends_on` and gives visibility.

### Inspect

```bash
docker compose up --build -d
docker compose ps                    # STATUS column: "Up 10 seconds (health: starting)" → "(healthy)"
docker compose logs                  # all services
docker compose logs -f backend       # one service, follow
docker inspect --format "{{json .State.Health}}" url-shortener-backend-1   # last health check results
docker compose up --build -d --wait  # returns only when everything is healthy (handy in scripts)
```

> **SEMINAR DEMO CHECKPOINT — Demo 8: Health Checks**
>
> | | |
> |---|---|
> | **Initial state** | `docker compose down -v` (fresh volume, so PostgreSQL has to initialize). |
> | **Actions** | 1. `docker compose up --build -d`, then run `docker compose ps` repeatedly. 2. Point out the startup order: postgres/redis `health: starting` → `healthy`, then backend, then frontend. `docker compose logs backend` shows **no** connection-refused crash (compare with Phase 7). 3. `curl http://localhost:8000/api/health` → `{"status":"ok","database":"ok","redis":"ok"}`. 4. **Running ≠ ready:** `docker compose stop postgres`. `curl -i http://localhost:8000/api/health` → `503 {"status":"error","database":"error",...}`. After about 30 s, `docker compose ps` shows backend `Up ... (unhealthy)`: the container is running, but the app is not ready. 5. `docker compose stop redis` (with postgres started again) → `"status":"degraded"`. |
> | **Expected output** | As above. |
> | **Concept** | Liveness of a process vs readiness of an application; health-gated startup with `depends_on.condition`. |
> | **Restore** | `docker compose start postgres redis`; within about 10 s the backend is `healthy` again (`pool_pre_ping` reconnects automatically). |

---

## Phase 10 — Testing, Cleanup, and Seminar Preparation

**Goal:** verify the whole system end to end and prepare a reliable live demo.

### Files

| Action | File |
|---|---|
| FILL | `README.md` |

### 10.1 Automated tests

Working directory `backend/` (venv active):

```bash
python -m pytest -v
```

Expected: **7 passed** (`test_health` + 6 URL tests), using SQLite and no Redis.

### 10.2 System test matrix (Docker Compose stack)

Start: `docker compose up --build -d --wait` (repo root).

| # | Test | Action | Expected |
|---|---|---|---|
| 1 | Compose startup | `docker compose ps` | 4 services `Up (healthy)` |
| 2 | Health | `curl http://localhost:8000/api/health` | `{"status":"ok","database":"ok","redis":"ok"}` |
| 3 | Frontend | Open <http://localhost:8080> | Page loads; `docker` entry listed |
| 4 | URL creation | Shorten `https://www.postgresql.org/docs/` | Short URL `http://localhost:8080/xxxxxxx` shown and listed |
| 5 | URL validation (client) | Submit `abc` | Browser validation message |
| 6 | URL validation (server) | `curl -i -X POST localhost:8080/api/urls -H "Content-Type: application/json" -d '{"original_url":"ftp://x"}'` | `422` |
| 7 | Redirect | `curl -i http://localhost:8080/<code>` | `302`, `location: https://www.postgresql.org/docs/` |
| 8 | Invalid short code | `curl -i http://localhost:8080/nope123` | `404 {"detail":"Short URL not found"}` |
| 9 | Click count | Click the link twice, return to the tab | `2 clicks` |
| 10 | Copy | Click **Copy**, paste | Short URL |
| 11 | Redis MISS/HIT | `docker compose logs backend` after test 7 + repeat | `Cache MISS` then `Cache HIT` |
| 12 | Deletion + invalidation | Delete in the UI, then `curl -i` the code | Log `[REDIS] Invalidated`, then `404` |
| 13 | Container restart | `docker compose restart backend` | Data intact; app healthy again |
| 14 | PostgreSQL persistence | `docker compose down`, then `docker compose up -d --wait` | All URLs and click counts intact |
| 15 | Full reset | `docker compose down -v`, then `up -d --wait` | Only the `docker` seed entry remains |
| 16 | Health degradation | `docker compose stop postgres`, then health | `503`, backend becomes `unhealthy`; `start postgres` recovers |

### 10.3 Clean setup test

On a machine (or folder) with **only Git and Docker** installed:

```bash
git clone <repository-url>
cd url-shortener
docker compose up --build
```

Open <http://localhost:8080>. No Python, Node.js, PostgreSQL or Redis installation and no `.env` file is required: Compose uses the defaults. Stop with `Ctrl+C`, then `docker compose down`.

> If ports 8080 or 8000 are taken: `cp .env.example .env`, change `FRONTEND_PORT` (and `BASE_URL` to match) or `BACKEND_PORT`, then `up` again.

### 10.4 README

`README.md` (FILL)

````markdown
# URL Shortener — Docker Seminar Demo

A minimal URL shortener (Next.js + FastAPI + PostgreSQL + Redis + Nginx) used to demonstrate
Docker images, multi-stage builds, containers, port mapping, networks, volumes, Docker Compose and health checks.

## Quick start

Requirements: Git and Docker (Compose v2.24+).

```bash
docker compose up --build
```

- App: http://localhost:8080
- API docs: http://localhost:8000/docs
- Health: http://localhost:8000/api/health

Stop: `docker compose down` (keeps data) · Reset: `docker compose down -v` (deletes data)

Optional configuration: copy `.env.example` to `.env` and adjust.

## Local development (without Docker)

See `docs/IMPLEMENTATION_GUIDE.md`, Phases 0–2.

```bash
cd backend
python -m venv .venv
# activate the venv, then:
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
python -m pytest
```

Frontend (Node.js 20.9+), from `frontend/`: `npm install`, then `npm run dev` → http://localhost:3000

## Architecture

Browser → Nginx (frontend: Next.js static export, built in a multi-stage image) → FastAPI (backend) → Redis (cache) / PostgreSQL (data, named volume)

The full step-by-step guide is in `docs/IMPLEMENTATION_GUIDE.md`.
````

### 10.5 Seminar preparation

**Before the session**

```bash
# Pre-pull images so the demo does not depend on conference Wi-Fi
docker pull python:3.12-slim
docker pull node:22-alpine
docker pull nginx:1.27-alpine
docker pull postgres:16-alpine
docker pull redis:7-alpine

# Pre-build once so layers are cached
docker compose build
```

- Increase the terminal font size. Keep two terminals open: one for commands, one for `docker compose logs -f backend`.
- Keep a git tag per phase (`git tag phase-3` and so on) so you can jump back if a live edit goes wrong.
- Close anything that uses ports 3000, 5432, 6379, 8000 or 8080.

**Demo order:** Demo 1 (local app) → 2 (image/container) → 3 (ports) → 4 (network) → 5 (volume) → 6 (Compose) → 7 (Redis) → 8 (health).

**Full reset between rehearsals** (repo root):

```bash
docker compose down -v
docker rm -f frontend backend backend2 postgres
docker network rm url-shortener-net
docker volume rm url-shortener-pgdata
docker volume prune -f       # removes orphaned anonymous volumes from Demo 5
```

(Errors like "No such container" are fine.)

---

## Final Architecture

```text
                         Browser
                            │  http://localhost:8080
                            ▼
              ┌───────── frontend (Nginx :80) ─────────┐
              │  static: Next.js export (out/)         │
              │  /api/*  and  /{short_code} → proxy    │
              └────────────────────┬───────────────────┘
                                   │ HTTP  backend:8000
                                   ▼
                        backend (FastAPI :8000) ◀── localhost:8000 (/docs, optional)
                                   │
               ════════ Docker network: shortener-net ════════
                         ┌─────────┴──────────┐
                         ▼                    ▼
                  redis (:6379)        postgres (:5432)
                  cache, no volume            │
                                              ▼
                                   Docker volume: pgdata
                                   /var/lib/postgresql/data
```

```mermaid
flowchart TD
    B[Browser] -->|:8080| F[frontend<br/>Nginx]
    F -->|/api/* , /code| BE[backend<br/>FastAPI]
    BE -->|redis://redis:6379| R[(redis)]
    BE -->|postgres:5432| P[(postgres)]
    P --- V[(volume: pgdata)]
    subgraph shortener-net [Docker network: shortener-net]
        F
        BE
        R
        P
    end
```

### Request flow (create / list / delete)

```text
Browser (UrlForm / RecentUrls → lib/api.js)
→ frontend: Nginx  location /api/
→ backend: FastAPI router  /api/urls
→ url_service → PostgreSQL  (delete also → Redis invalidate)
→ JSON response → Nginx → Browser renders the list
```

### Redirect flow

```text
Short URL  http://localhost:8080/aB3dE9x
→ Nginx: not a static file → @backend
→ FastAPI  GET /{short_code}
→ Redis lookup  url:aB3dE9x
     HIT  → use cached URL
     MISS → PostgreSQL SELECT → Redis SET (TTL)
→ PostgreSQL  click_count + 1
→ 302 Location: original URL
```

### Docker component mapping

| Component | Docker concepts demonstrated |
|---|---|
| `backend/Dockerfile` | Dockerfile, base image, layers and caching, `WORKDIR`/`COPY`/`RUN`/`CMD`, `.dockerignore`, `0.0.0.0` binding |
| `frontend/Dockerfile` + `nginx.conf` | **Multi-stage build** (Node.js build stage → Nginx runtime, no Node.js in the final image), `.dockerignore` for `node_modules`, static serving, reverse proxy, port mapping `8080:80` |
| `postgres` service | Official image configured with environment variables, init scripts (bind mount), **named volume** |
| `redis` service | Adding a service with zero custom code; ephemeral (no volume) by design |
| `shortener-net` | User-defined network, DNS by service name, no hard-coded IPs |
| `pgdata` | Data lifecycle independent of container lifecycle |
| `compose.yaml` | Declarative multi-container app, `build`/`image`/`ports`/`environment`/`env_file`/`volumes`/`networks`/`depends_on` |
| `healthcheck` + `condition: service_healthy` | Running vs ready, health-gated startup |
| `.env` / `.env.example` | Configuration through environment variables, secrets kept out of git |

---

## Final Project Structure

Legend: **(reused)** existing file unchanged · **(modified)** existing file with content changed · **(filled)** existing empty placeholder now implemented · **(new)** file added by this guide

```text
url-shortener/
├── .env.example                 (filled)    Compose settings example
├── .gitignore                   (filled)
├── compose.yaml                 (filled)
├── README.md                    (filled)
│
├── docs/
│   └── IMPLEMENTATION_GUIDE.md  (new)
│
├── docker/
│   └── postgres/
│       └── init.sql             (filled)
│
├── frontend/
│   ├── Dockerfile               (filled)    multi-stage: node:22-alpine build → nginx
│   ├── .dockerignore            (new)
│   ├── nginx.conf               (filled)
│   ├── package.json             (reused)    Next.js 16, React 19
│   ├── package-lock.json        (reused)
│   ├── next.config.mjs          (reused)    output: 'export'
│   ├── .env.development         (reused)    NEXT_PUBLIC_API_BASE_URL for npm run dev
│   ├── app/
│   │   ├── layout.jsx           (reused)    imports the global CSS
│   │   └── page.jsx             (modified)  refresh state, RecentUrls
│   ├── components/
│   │   ├── UrlForm.jsx          (modified)  onCreated, server error messages
│   │   └── RecentUrls.jsx       (new)       list, copy, delete, click count
│   ├── lib/
│   │   ├── api.js               (modified)  request helper, list, delete
│   │   └── utils.js             (new)
│   └── css/
│       ├── reset.css            (reused)
│       └── style.css            (modified)  list styles appended
│
└── backend/
    ├── Dockerfile               (filled)
    ├── .dockerignore            (new)
    ├── .env.example             (new)       local development settings
    ├── requirements.txt         (modified)  pinned ranges, psycopg[binary], pydantic-settings, redis
    ├── requirements-dev.txt     (new)
    ├── app/
    │   ├── __init__.py          (new, optional; see note below)
    │   ├── main.py              (filled)
    │   ├── api/
    │   │   ├── __init__.py      (reused)
    │   │   └── urls.py          (filled)
    │   ├── core/
    │   │   ├── __init__.py      (reused)
    │   │   └── config.py        (filled)
    │   ├── db/
    │   │   ├── __init__.py      (reused)
    │   │   ├── database.py      (filled)
    │   │   └── models.py        (filled)
    │   ├── schemas/
    │   │   ├── __init__.py      (reused)
    │   │   └── url.py           (filled)
    │   ├── services/
    │   │   ├── __init__.py      (reused)
    │   │   ├── cache_service.py (filled)
    │   │   └── url_service.py   (filled)
    │   └── utils/
    │       ├── __init__.py      (reused)
    │       └── short_code.py    (filled)
    └── tests/
        ├── conftest.py          (new)
        ├── test_health.py       (filled)
        └── test_urls.py         (filled)
```

Not committed: `.env`, `backend/.env`, `backend/.venv/`, `__pycache__/`, `backend/tests/test.db`, `frontend/node_modules/`, `frontend/.next/`, `frontend/out/`.

> `backend/app/__init__.py` is not in the current repository, which only has `__init__.py` in the sub-packages. Running from `backend/` works without it, because `app` is treated as a namespace package. Adding an empty `backend/app/__init__.py` is optional but recommended for clarity.

---

## Development Roadmap

Copy this into an issue or project board and assign phases to team members. Phases 3–4 can be done in parallel once Phase 2 is merged; everything else is sequential.

```text
Phase 0 — Repository setup
[ ] .gitignore filled; .env removed from git tracking
[ ] requirements.txt updated; requirements-dev.txt added
[ ] backend/.env.example added; backend/.env created locally
[ ] config.py and main.py (health) implemented
[ ] Node.js 20.9+ installed; npm install done
[ ] Frontend runs on :3000 (npm run dev)
[ ] GET /api/health → {"status":"ok"}; pytest passes

Phase 1 — URL Shortener MVP
[ ] short_code.py, schemas/url.py
[ ] In-memory url_service.py
[ ] api/urls.py: POST/GET/DELETE /api/urls, GET /{short_code}
[ ] lib/api.js refactor (request helper, listUrls, deleteUrl)
[ ] lib/utils.js, RecentUrls.jsx (list/copy/delete), UrlForm onCreated, page.jsx, style.css
[ ] Create, redirect (302), 404, delete, click count work in UI
[ ] test_urls.py passes

Phase 2 — PostgreSQL
[ ] Local PostgreSQL installed; user/db "shortener" created
[ ] database.py, models.py
[ ] url_service.py + api/urls.py use the DB session
[ ] main.py lifespan create_all
[ ] conftest.py uses SQLite
[ ] Data survives FastAPI restart; click_count persists
[ ] Demo 1 rehearsed

Phase 3 — Backend Docker
[ ] backend/Dockerfile, backend/.dockerignore
[ ] docker build / run / ps / logs / stop / rm practiced
[ ] Health works from the container on :8000
[ ] Demo 2 rehearsed

Phase 4 — Frontend Docker
[ ] frontend/nginx.conf, multi-stage frontend/Dockerfile, frontend/.dockerignore
[ ] Bonus demo: build-stage vs final image size; no node in final image
[ ] Page served on localhost:8080
[ ] Demo 3 (no -p vs -p 8080:80) rehearsed

Phase 5 — Network
[ ] url-shortener-net created; postgres container running
[ ] localhost failure reproduced; fixed with host "postgres"
[ ] frontend → backend → postgres works end to end
[ ] Demo 4 rehearsed

Phase 6 — Volume
[ ] Data loss without volume reproduced
[ ] Named volume url-shortener-pgdata keeps data across container re-creation
[ ] Demo 5 rehearsed

Phase 7 — Compose
[ ] init.sql, .env.example, compose.yaml (3 services)
[ ] docker compose up --build / down / down -v work
[ ] Demo 6 rehearsed

Phase 8 — Redis
[ ] cache_service.py; url_service.py cache-aside + invalidation
[ ] redis service + REDIS_URL in compose.yaml
[ ] MISS → HIT logs visible; fallback when Redis is stopped
[ ] Demo 7 rehearsed

Phase 9 — Healthcheck
[ ] /api/health checks database + redis (503 when DB down)
[ ] Healthchecks for postgres, redis, backend, frontend
[ ] depends_on uses condition: service_healthy
[ ] No startup crash on fresh volume
[ ] Demo 8 rehearsed

Phase 10 — Final testing
[ ] pytest: 7 passed
[ ] System test matrix (16 checks) passed
[ ] Clean clone + docker compose up --build works
[ ] README.md written
[ ] Images pre-pulled; full reset script tested
[ ] Git tags per phase created
```

---

## Appendix — Optional Extension: Custom Alias

Only if time allows. It touches one schema, one service function and one input field, and needs no new Docker concepts.

1. `schemas/url.py`: add `custom_alias: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{3,32}$")` to `UrlCreate` (import `Field` from `pydantic`).
2. `url_service.create_url(db, original_url, custom_alias=None)`: if an alias is given and `get_url(db, alias)` exists, raise a custom error. Otherwise use the alias instead of `_unique_short_code(db)`. Reject aliases that collide with reserved paths (`api`, `docs`, `openapi.json`, `_next`, `404`).
3. `api/urls.py`: pass `payload.custom_alias` and map the "already exists" error to `HTTPException(409, "Alias already in use")`.
4. Frontend: an optional `<input name="alias">` in `UrlForm.jsx`, sent as `custom_alias` by `shortenUrl()`. `readError()` already shows the `409` message.

URL expiration and statistics are intentionally left out to keep the focus on Docker.
