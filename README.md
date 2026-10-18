# URL Shortener

A URL shortener for demonstrating Docker containerization and multi-service application management. The project is being built in phases, starting with a local Next.js frontend and FastAPI health endpoint.

## Current status

The Phase 0 application baseline is implemented: a responsive monochromatic Next.js frontend, a draggable URL field, environment-based FastAPI configuration, and `GET /api/health`. The health test passed during the latest project review.

URL shortening is not implemented yet. The button resizes the field while dragging, but converting a URL requires the Phase 1 API. The recent-links section is a placeholder. Database persistence, Redis caching, and Docker deployment are planned.

| Feature | Status |
|---|---|
| Frontend layout and click/drag interaction | Implemented |
| FastAPI health endpoint and test | Implemented |
| Database design and initial table SQL | Defined; not integrated or executed by the app |
| Create short URLs, redirect, list, copy, delete, and count clicks | Planned |
| URL expiration enforcement | Planned |
| PostgreSQL persistence | Planned |
| Redis redirect cache | Planned |
| Nginx, Docker images, networking, volumes, and Compose | Planned |

## Architecture and tech stack

Current local setup:

```text
Browser --> Next.js dev server :3000
Browser --> FastAPI :8000 --> GET /api/health
```

The frontend reads its API base URL from `NEXT_PUBLIC_API_BASE_URL`. [frontend/.env.development](frontend/.env.development) sets it to `http://localhost:8000` for `npm run dev`. Production builds leave it empty, so requests go to `/api/urls` on the same origin (Nginx in Docker). Backend CORS allows the dev-server origin `http://localhost:3000`.

Target Docker architecture:

```text
Browser :8080
    |
    v
Frontend (Nginx :80)
    | Next.js static export (built in a multi-stage image)
    | /api/* and /{short_code} proxied to backend:8000
    v
Backend (FastAPI :8000)
    |                  |
    v                  v
PostgreSQL :5432     Redis :6379
    |
    v
Named Docker volume
```

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 16 (React 19, App Router, static export) | URL form and recent links |
| Frontend build | Node.js 22 (Docker build stage only) | Planned multi-stage image: Node.js builds, Nginx serves; no Node.js in the final image |
| Web server | Nginx | Planned static serving and reverse proxy |
| Backend | Python, FastAPI, Uvicorn | HTTP API and redirects |
| Configuration | pydantic-settings | Environment variables and local `.env` |
| Persistence | PostgreSQL, SQLAlchemy, psycopg | Planned URL records and click counts |
| Cache | Redis | Planned redirect cache |
| Deployment | Docker and Docker Compose | Planned multi-service demonstration |
| Testing | pytest, httpx | API tests |

## Project structure

Python subpackages also contain empty `__init__.py` files. Empty asset/documentation folders are omitted because Git does not track them.

```text
url-shortener/
├── frontend/
│   ├── app/
│   │   ├── layout.jsx               # Root layout, imports global CSS
│   │   └── page.jsx                 # Home page
│   ├── components/
│   │   └── UrlForm.jsx              # Draggable shorten/expand form
│   ├── lib/
│   │   └── api.js                   # Backend API client
│   ├── css/
│   │   ├── reset.css
│   │   └── style.css
│   ├── .env.development             # API base URL for npm run dev
│   ├── next.config.mjs              # output: 'export'
│   ├── package.json
│   ├── package-lock.json
│   ├── nginx.conf                   # Placeholder
│   └── Dockerfile                   # Placeholder
├── backend/
│   ├── app/
│   │   ├── main.py                  # Health endpoint and CORS
│   │   ├── core/config.py           # Settings
│   │   ├── api/urls.py              # Placeholder
│   │   ├── db/
│   │   │   ├── database.py          # Placeholder
│   │   │   └── models.py            # Placeholder
│   │   ├── schemas/url.py           # Placeholder
│   │   ├── services/
│   │   │   ├── url_service.py       # Placeholder
│   │   │   └── cache_service.py     # Placeholder
│   │   └── utils/short_code.py      # Placeholder
│   ├── tests/
│   │   ├── conftest.py
│   │   ├── test_health.py
│   │   └── test_urls.py             # Placeholder
│   ├── .env.example                 # Currently empty; use root example
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── Dockerfile                   # Placeholder
├── docker/postgres/init.sql         # Table definition; not wired into Compose
├── docs/
│   ├── DATABASE_DESIGN.md
│   └── IMPLEMENTATION_GUIDE.md
├── .env.example                     # Current local-development template
├── .gitignore
├── compose.yaml                     # Placeholder
└── README.md
```

## Prerequisites

For Phase 0, install Git, Python 3.11 or later, and Node.js 20.9 or later (Next.js 16 requirement; Node.js 22 LTS recommended). Python 3.12 is the implementation guide's reference version. A browser is needed to view the frontend.

Node.js is only needed for local development. From Phase 4 the frontend image builds itself in a Node.js build stage, so running the app through Docker requires neither Node.js nor Python on the host.

PostgreSQL is needed from Phase 2. Docker Desktop or Docker Engine with Compose is needed from Phase 3. Redis is introduced in Phase 8. None of these services is required to run the current health endpoint.

## Local quick start

The commands below use Windows PowerShell. Run the two servers in separate terminals and leave them running.

### 1. Clone the repository

```powershell
git clone https://github.com/zaabinh/url-shortener.git
cd url-shortener
```

### 2. Set up and start the backend

From the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
```

For a fresh clone, copy the populated root environment example into `backend/.env`:

```powershell
Copy-Item ..\.env.example .env
```

Keep an existing `backend/.env` if you have already configured it. The backend-level `.env.example` is currently empty. The root example currently describes local development; a separate Compose template will be needed when Docker deployment is implemented.

Start FastAPI from `backend/` so its relative `.env` path resolves correctly:

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

If PowerShell blocks virtual environment activation, invoke its interpreter directly instead:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 3. Start the frontend

In a second terminal, from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

`npm install` is needed only once (and after `package.json` changes). The dev server reloads on save.

On macOS/Linux, activate the backend environment with `source .venv/bin/activate` and copy the example with `cp ../.env.example .env`. Use `python3` if that is your interpreter command.

### 4. Verify the baseline

| Address | Expected result |
|---|---|
| <http://localhost:3000> | Styled URL form |
| <http://localhost:8000/api/health> | HTTP 200 with `{"status":"ok"}` |
| <http://localhost:8000/docs> | Swagger UI showing the health endpoint |

The current health endpoint checks that FastAPI responds; it does not test database or Redis connectivity.

Shortening is expected to fail at this phase because the URL endpoints are not implemented. Docker startup commands are intentionally deferred: `compose.yaml`, Dockerfiles, and `nginx.conf` are placeholders.

## Configuration

Settings are defined in [backend/app/core/config.py](backend/app/core/config.py). Environment variables override `.env` values.

| Variable | Default in code | Purpose |
|---|---|---|
| `APP_NAME` | `URL Shortener` | FastAPI application title |
| `BASE_URL` | `http://localhost:8000` | Public origin for generated links |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed frontend origins (Next.js dev server) |
| `SHORT_CODE_LENGTH` | `7` | Planned generated code length |
| `DATABASE_URL` | Empty | Planned SQLAlchemy PostgreSQL connection URL |
| `REDIS_URL` | Empty | Planned Redis connection; empty disables cache |
| `CACHE_TTL_SECONDS` | `3600` | Planned maximum redirect-cache lifetime |

The example database URL targets `localhost` for development. Container connections will use Compose service names instead. Real `.env` files, virtual environments, `node_modules/`, `.next/` and `out/` are ignored by Git. `frontend/.env.development` holds no secrets and is committed.

Frontend variable: `NEXT_PUBLIC_API_BASE_URL` (in `frontend/.env.development`). Next.js inlines it **at build time**, so changing it requires restarting `npm run dev` or rebuilding.

## Tests

From `backend/`, with the virtual environment active:

```powershell
python -m pytest -q
```

Current expected result: **1 passed**. `test_health.py` checks the health response through FastAPI's test client; `test_urls.py` is still empty. The health test requires no PostgreSQL or Redis service. Stop development servers with `Ctrl+C` when finished.

## Database design

[Database design](docs/DATABASE_DESIGN.md) defines the `urls` table, constraints, expiration rules, click-count updates, and future cache behavior. The existing [SQL initialization script](docker/postgres/init.sql) defines the table, including the required `expired_at` column.

The table is designed but the app does not yet connect to a database. SQLAlchemy models, session management, and expiration enforcement remain implementation work.

## Development roadmap

### Phase 0 — Setup

- [x] Repository structure ready
- [x] Frontend runs locally
- [x] FastAPI runs locally
- [x] Health endpoint and test work
- [x] Database design documented
- [ ] Populate `backend/.env.example` so the backend has its own local template

### Phase 1 — URL Shortener MVP

- [ ] Create and validate short URLs
- [ ] Redirect short URLs; handle missing and expired codes
- [x] Configure the API base URL for local development
- [ ] Display recent URLs, copy links, and delete entries
- [ ] Track click counts and add API tests

### Phase 2 — PostgreSQL

- [ ] Implement SQLAlchemy models and sessions matching the database design
- [ ] Persist URLs, expiration timestamps, and click counts
- [ ] Verify data survives backend restarts

### Phase 3 — Backend Docker

- [ ] Add backend Dockerfile and `.dockerignore`
- [ ] Build and run the backend image

### Phase 4 — Frontend Docker

- [ ] Configure Nginx static serving and proxying
- [ ] Add a multi-stage frontend Dockerfile (Node.js build → Nginx) and `.dockerignore`
- [ ] Build the frontend image and verify port mapping

### Phase 5 — Docker Network

- [ ] Connect services using Docker DNS service names
- [ ] Verify frontend-to-backend-to-PostgreSQL requests

### Phase 6 — Docker Volume

- [ ] Configure PostgreSQL's named volume
- [ ] Verify data survives container recreation

### Phase 7 — Docker Compose

- [ ] Define frontend, backend, and PostgreSQL services
- [ ] Wire the initialization script and environment configuration
- [ ] Start the application with one command

### Phase 8 — Redis

- [ ] Add Redis as the fourth service
- [ ] Demonstrate cache MISS, HIT, expiration, and invalidation
- [ ] Fall back to PostgreSQL when Redis is unavailable

### Phase 9 — Health Checks

- [ ] Add database and Redis checks to backend health reporting
- [ ] Configure container healthchecks and startup dependencies

### Phase 10 — Seminar Readiness

- [ ] Test the full demo and clean-clone setup
- [ ] Prepare Git checkpoints and reset/cleanup scripts
- [ ] Capture backup screenshots and videos
- [ ] Complete a full rehearsal

## Documentation

- [Database design](docs/DATABASE_DESIGN.md)
- [Step-by-step implementation guide](docs/IMPLEMENTATION_GUIDE.md)

The implementation guide describes later phases as well as an initial repository snapshot. Use this README for current status. The database design includes `expired_at`, which must be added to the guide's earlier model and API examples when those phases are implemented.
