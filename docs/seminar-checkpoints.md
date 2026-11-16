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
- Dockerfile:
```dockerfile
// Choose foundation
FROM python:3.12-slim
// Choose work directory
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
// Copy and install requirements
COPY requirements.txt ./
// Run when build
RUN python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.txt
COPY app ./app
// Describe port, not open host port
EXPOSE 8000
// Run after container built
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

