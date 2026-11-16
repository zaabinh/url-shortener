# 00: Local CRUD, redirect, expiration: 2 smoke tests passed.
- Short URL local CRUD without Redis
# 01: Empty Python evironment reproduces missing uvicorn.
- Create empty python venv with `python venv .venv-empty`
- Run `uvicorn main.app:app --reload` to reproduces missing environment situation
# 02: Image vs container, process lifecycle, container vs VM explained.
- Use `docker image ls` to list current Docker images in this device
- Starting container `seminar-concepts` from image `alpine:3.22`  with `docker run --name seminar-concepts alpine:3.22`
- See running containers with `docker ps`
- See all containers with `docker ps -a`, use `--filter` to filter containers
- Use `docker rm` to remove a container
- Use `docker logs` to read logs# 03: Backend image built; container start/stop/logs verified; DB not yet guaranteed.
# 03: Dockerize backend
- Add venv, pycache, git, .env to .dockerignore
- .env.docker:
```powershell
DATABASE_URL=postgresql+psycopg://shortener_user:shortener_password@host.docker.internal:5432/url_shortener
REDIS_URL=
BASE_URL=http://localhost:8001
CORS_ORIGINS=http://localhost:3000
CACHE_TTL_SECONDS=3600
```
- Dockerfile:
```dockerfile
# Choose foundation
FROM python:3.12-slim
# Choose work directory
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Copy and install requirements
COPY requirements.txt ./
# Run when build
RUN python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.txt
COPY app ./app
# Describe port, not open host port
EXPOSE 8000
# Run after container built
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
- Create .env.docker
- Build image with `docker build -t url-shortener-backend:p03 backend`
- Run container from built image with `docker run -d --name seminar-backend:p03 --env-file .env.docker url-shortener-backend:p03`
- `docker inspect` to inspect image status
- `docker stop` / `docker start`

# 04: Port mapping
- Use `curl.exe --max-time 3 http://localhost:8001/app/health` to ping to running backend container (since .env.docker configure backend BASE_URL to localhost:8001 to distinguish with local backend port)
- Stop and remove current backend container
- Create new container with port mapping

```powershell
docker run -d --name seminar-backend-p04 --env-file backend/.env.docker -p 127.0.0.1:8001:8000 url-shortener-backend:p03
```

- Use `docker port seminar-backend-p04` to check backend container ports
- Check server status with `Invoke-RestMethod http://localhost:8001/app/health` or `curl.exe --max-time 3 http://localhost:8001/app/health`

- Check for database connection
```powershell
$env:SMOKE_BASE_URL = 'http://localhost:8001'
backend/.venv/Scripts/python.exe backend/tests/smoke_api.py
Remove-Item Env:SMOKE_BASE_URL
```
- **NOTE:** Since `DATABASE_URL` host is set to host.docker.internal so Docker backend can connect to running PostgresSQL database on local device

# 05: Registry and PostgreSQL container

- Registry is the place containing images which can be private/public. DockerHub is a cloud-based registy where developers push and pull images and container (Like GitHub)
- Pull postgres image instead of create a new one
```powershell
# postgres is repository, 17-alpine is tag
docker pull postgres:17-alpine
# 
docker image inspect postgres:17-alpine --format '{{json .RepoDigests}}'
```
- Run container
```powershell 
docker run -d --name seminar-pg `
  -e POSTGRES_USER=shortener_user `
  -e POSTGRES_PASSWORD=shortener_password `
  -e POSTGRES_DB=url_shortener `
  -p 127.0.0.1:5433:5432 `
  --mount "type=bind,source=$initSql,target=/docker-entrypoint-initdb.d/001-init.sql,readonly" `
  postgres:17-alpine
```

- Add waiting function to no run SQL before DB ready

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

## 5.5. Login, tag, and push container to DockerHub
```powershell
docker login
docker tag url-shortener-backend:p03 YOUR_DOCKERHUB_USER/url-shortener-backend:p03
docker push YOUR_DOCKERHUB_USER/url-shortener-backend:p03
```

# 06: Docker Network
- For the containers to communicate with each other through localhost, we should configure a Docker Network
- Create network
```powershell
docker network create seminar-net
# Connect database to the network
docker network connect seminar-net seminar-pg
```

- Change .env to: (Changed db url host)
```powershell
DATABASE_URL=postgresql+psycopg://shortener_user:shortener_password@seminar-pg:5432/url_shortener
REDIS_URL=
BASE_URL=http://localhost:8001
CORS_ORIGINS=http://localhost:3000
CACHE_TTL_SECONDS=3600
```

- Run docker network and check for db connection
```powershell
docker run --rm --network seminar-net --env-file backend/.env.docker url-shortener-backend:p03 python -c "from app.db.database import engine; engine.connect(); print('Connected')"
```

- Replace backend container in phase 4 with network connected container. 
```powershell
docker stop seminar-backend-p04
docker rm seminar-backend-p04
# create container
docker run -d --name seminar-backend --network seminar-net --env-file backend/.env.docker -p 127.0.0.1:8001:8000 url-shortener-backend:p03
# Check for db connection
docker exec seminar-backend python -c "import socket; print(socket.gethostbyname('seminar-pg'))"
docker network inspect seminar-net
# Run backend test
$env:SMOKE_BASE_URL = 'http://localhost:8001'
backend/.venv/Scripts/python.exe backend/tests/smoke_api.py
Remove-Item Env:SMOKE_BASE_URL
```
# 07: Docker volume
- Example: Recreate db container with Docker Volume to store data even container is removed
```powershell
# Remove container
docker stop seminar-pg
docker rm -v seminar-pg
# Create volume 
docker volume create seminar-pg-data
# Recreate container
$initSql = (Resolve-Path docker/postgres/init.sql).Path
docker run -d --name seminar-pg --network seminar-net `
  -e POSTGRES_USER=shortener_user `
  -e POSTGRES_PASSWORD=shortener_password `
  -e POSTGRES_DB=url_shortener `
  -p 127.0.0.1:5433:5432 `
  # Assign created volume to store data
  --mount type=volume,source=seminar-pg-data,target=/var/lib/postgresql/data `
  --mount "type=bind,source=$initSql,target=/docker-entrypoint-initdb.d/001-init.sql,readonly" `
  postgres:17-alpine
Wait-Pg seminar-pg
# Add example data
docker exec seminar-pg psql -U shortener_user -d url_shortener -c "INSERT INTO urls (id,short_code,original_url,expires_at) VALUES ('22222222-2222-4222-8222-222222222222','persistent-demo','https://example.com',NOW()+INTERVAL '1 day');"
# Remove container
docker stop seminar-pg
docker rm seminar-pg
```

- Then, recreate the container again with that volume
```powershell
docker run -d --name seminar-pg --network seminar-net `
  -e POSTGRES_USER=shortener_user `
  -e POSTGRES_PASSWORD=shortener_password `
  -e POSTGRES_DB=url_shortener `
  -p 127.0.0.1:5433:5432 `
  --mount type=volume,source=seminar-pg-data,target=/var/lib/postgresql/data `
  --mount "type=bind,source=$initSql,target=/docker-entrypoint-initdb.d/001-init.sql,readonly" `
  postgres:17-alpine
```

- Check that old data remains

```powershell
Wait-Pg seminar-pg
docker exec seminar-pg psql -U shortener_user -d url_shortener -c "SELECT short_code FROM urls WHERE short_code='persistent-demo';"
docker start seminar-backend
docker volume inspect seminar-pg-data
```
| Concept | In practice |
|---|---|
| Writable layer | File created filesystem container, removed with container |
| Anonymous volume | Docker names it randomly, difficult to restore |
| Named volume | Re-integrate with new container by name |
| Bind mount | init.sql on host mounted read-only into container |

- CAUTION: Named volume is not wrapped with image when image pulled to another machine, so volume cannot replace backup. 
  - Volume keep **live data** remains when restart or recreate containers. For example, you can restart backend containers to update code and recover the data you are working on with volume, and if you delete tables or records, you can't restore them.
  - Backup save and restore **data** when system encounter an error that lead to lost data, or you just simply need to change the machine.
- Create backup data saved
```powershell
docker exec seminar-pg pg_dump -U shortener_user -d url_shortener -f /tmp/seminar.sql
docker cp seminar-pg:/tmp/seminar.sql ./seminar-backup.sql
```

# 08: Docker Compse and frontend container
- Update backend image that have runtime and test target
```Dockerfile
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

- Build frontend Next.js, serve with Nginx
```Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_PUBLIC_API_BASE_URL=""
RUN npm run build 

FROM nginxinc/nginx-unpriviledged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html
USER 101:101
EXPOSE 8080
```
- Create nginx.conf 
```nginx
server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    resolver 127.0.0.11 valid=10s;
    set $backend http://backend:8000;

    # REST API
    location /api/ {
        proxy_pass $backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend health
    location = /app/health {
        proxy_pass $backend;
        proxy_set_header Host $host;
    }

    # Frontend static files first
    # If no static resource exists, treat it as /{short_code}
    location / {
        try_files $uri $uri/ @short_redirect;
    }

    location @short_redirect {
        proxy_pass $backend$request_uri;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- Add compose.yaml
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
- Service `tests` is temporary for testing. In this part, there are just 3 service db, backend and frontend
- Add `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` to .env
- Run and test:
```powershell
# Stop manual backend and posgres containers
docker stop seminar-backend seminar-pg
# Check configuration
docker compose config --quiet
# Build docker compose
docker compose up -d --build --wait
# Check for running images
docker compose ps
# Check for logs
docker compose logs --tail 30 backend postgres
# Run tests
docker compose --profile test run --build --rm tests
```

# 09: Redis
## Redirect flow with Redis
![Redis_redirect_flow](./architecture/architecture.png)
## New compose.yaml:
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

- Rerun:
```powershell
docker compose config --quiet
docker compose up -d --build --wait
docker compose exec redis redis-cli ping
docker compose --profile test run --build --rm tests
```
- Test MISS, HIT and click-count
```powershell
$demoPayload = @{
    original_url = 'https://example.com/docker-cache'
    expires_at = [DateTimeOffset]::UtcNow.AddMinutes(10).ToString('o')
} | ConvertTo-Json
# Call API create url
$demoUrl = Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/urls -ContentType 'application/json' -Body $demoPayload
$shortCode = $demoUrl.short_code
# Remove Redis cache 1:exist, 0:no exists
docker compose exec redis redis-cli DEL "url:$shortCode"
# Call short url
curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8080/$shortCode"
# Read log
docker compose logs --since 1m backend
# Check url menu in Redis
docker compose exec redis redis-cli GET "url:$shortCode"
# Check TTL
docker compose exec redis redis-cli TTL "url:$shortCode"
```
- Check for click_count
```powershell
curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8080/$shortCode"
docker compose logs --since 1m backend
docker compose exec postgres psql -U shortener_user -d url_shortener -c "SELECT short_code,click_count FROM urls WHERE short_code='$shortCode';"
```
- Redis error - fallback DB
```powershell
docker compose stop redis
curl.exe -s -o NUL -w '%{http_code}' "http://localhost:8080/$shortCode"
docker compose logs --since 1m backend
docker compose start redis
```