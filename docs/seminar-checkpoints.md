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

# 4. Port mapping
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

# 5. Registry and PostgreSQL container

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

# 6. Docker Network
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
