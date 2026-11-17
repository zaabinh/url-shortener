# URL Shortener

Docker seminar: [learning guide](docker_integration.md),
[English checkpoint report](docs/seminar-checkpoints.md), and
[PowerShell demos with presentation pauses](scripts/seminar/README.md).

```powershell
docker compose up -d --build --wait --wait-timeout 180
# Open http://localhost:8080. Only Nginx publishes a host port.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/09-redis.ps1
```

The stack contains a static Next.js/Nginx frontend, FastAPI, PostgreSQL with a named
volume, and disposable Redis. `GET /{code}` redirects; URL management uses
`/api/urls`. Git checkpoints run from `seminar/00-local` to `seminar/11-final`.
Phase-0 reset previews by default; `-Apply -DeleteData` explicitly erases seminar
database data. See the demo guide before resetting.

Local application using Next.js, FastAPI and PostgreSQL. Create short URLs with an optional custom code, redirect, count clicks, set expiration, and browse recent links. Redis caching is optional.

## Requirements

Python 3.11+, Node.js 20.9+, and a running PostgreSQL server. Leave `REDIS_URL=` to run without Redis. Commands below use PowerShell from the repository root.

## Database

Using an administrator PostgreSQL session, create the local role and database if they do not exist:

```sql
CREATE ROLE shortener_user WITH LOGIN PASSWORD 'shortener_password';
CREATE DATABASE url_shortener OWNER shortener_user;
```

Run CREATE DATABASE separately, outside a transaction. These are example local credentials; adjust them to your installation.

## Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r requirements-dev.txt
Copy-Item .env.example .env
```

Keep an existing backend/.env instead of overwriting it. Update DATABASE_URL to match your database, credentials and port.

Initialize a new database and start the API:

```powershell
.\.venv\Scripts\python.exe -c "from app.db.database import Base, engine; from app.db.models import Url; Base.metadata.create_all(bind=engine)"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

create_all creates missing tables; it does not migrate existing ones. The current schema uses UUID IDs and expires_at TIMESTAMPTZ. Older SERIAL/expired_at schemas need a data-preserving migration first.

## Frontend

In another terminal, from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open <http://localhost:3000>. frontend/.env.development sets the API to http://localhost:8000. Override it in frontend/.env.local if needed and restart Next.js after changing environment variables.

The form supports an optional 1-32 character alphanumeric custom code, expiration presets, Shorten/Expand, and Reset. After shortening, the URL control fits its text and padding while staying inside the form; expanding restores full width. After creation, Shorten/Expand only toggles the displayed URL; use Reset to create another link. Recent URLs includes Refresh, pagination, Copy, Go, and Delete. Back to top appears when scrolling to the list.

## API and configuration

Swagger: <http://localhost:8000/docs>.

| Method | Endpoint | Result |
|---|---|---|
| GET | /app/health | 200, `{"status":"healthy"}`; application liveness only |
| POST | /api/urls | 201; accepts original_url, optional expires_at and optional short_code |
| GET | /api/urls?limit=20&offset=0 | Newest links first; limit 1-100 |
| GET | /{short_code} | 302; missing 404, expired 410 |
| DELETE | /api/urls/{short_code} | 204; missing 404 |

Only HTTP/HTTPS destinations up to 2048 characters are accepted. A custom short code is trimmed, case-sensitive, and must contain 1-32 ASCII letters or digits; `api`, `app`, `docs`, and `redoc` are reserved. Blank input generates a random code, while an existing code returns 409. Explicit expiration must include a timezone and be in the future; omitted expiration defaults to 30 days. Clicks increase only on successful redirects. Redis errors fall back to PostgreSQL; database failures return 503.

Backend reads backend/.env. Process environment variables override file values.

| Variable | Purpose |
|---|---|
| DATABASE_URL | SQLAlchemy connection URL; see backend/.env.example |
| REDIS_URL | Empty disables Redis; otherwise e.g. redis://localhost:6379/0 |
| CACHE_TTL_SECONDS | Maximum cache lifetime, default 3600; 0 disables cache writes |
| CORS_ORIGINS | Comma-separated frontend origins |
| SHORT_CODE_LENGTH | Code length, default 7, allowed 1-32 |
| BASE_URL | Backend origin setting; frontend derives links from NEXT_PUBLIC_API_BASE_URL |

Cache hits still verify validity and update clicks in PostgreSQL. Redis does not replace the database.

## Checks

Backend tests use isolated in-memory SQLite databases and mocked Redis:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend API tests and production build:

```powershell
cd frontend
node --test tests/api.test.mjs
npm run build
```

Browser tests intercept API requests. Build with a same-origin API; Playwright starts the static server on port 8080 automatically:

```powershell
cd frontend
npm exec --no -- playwright install chromium
node -e "const r=require('node:child_process').spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{stdio:'inherit',env:{...process.env,NEXT_PUBLIC_API_BASE_URL:''}});process.exit(r.status??1)"
npm run test:e2e
```

On macOS/Linux use .venv/bin/python and `NEXT_PUBLIC_API_BASE_URL='' npm run build`.

See the [test catalog](docs/test/README.md), [database design](docs/DATABASE_DESIGN.md), [backend fixes](docs/BACKEND_FIXES.md), and the [Docker seminar walkthrough](docker_integration.md). Docker work continues on feature/docker, starting at seminar/00-local; use scripts/switch-tag.ps1 to select an existing checkpoint. Docker files are introduced at their respective stages; the baseline runs locally.

## Updating dependency locks

Python direct dependencies are pinned in backend/requirements.in and backend/requirements-dev.in. Generated .txt files lock all resolved dependencies with SHA256 hashes, including platform-specific packages. CI installs wheels only and verifies hashes. Runtime dependencies stay aligned between both locks.

After deliberately updating an input version, regenerate both locks from the repository root with uv 0.13.6:

```powershell
uv pip compile backend/requirements.in --universal --python-version 3.12 --generate-hashes --output-file backend/requirements.txt
uv pip compile backend/requirements-dev.in --constraint backend/requirements.txt --universal --python-version 3.12 --generate-hashes --output-file backend/requirements-dev.txt
```

Commit the input and generated lock changes together, then run tests. Frontend versions and integrity hashes are tracked in frontend/package-lock.json; npm ci installs that lock. CI invokes the installed Playwright binary directly, so a missing package fails instead of triggering an npx download. Chromium's revision is selected by that locked Playwright version; Linux system libraries installed by --with-deps still follow the runner's OS repositories.
