# 00: Local CRUD, redirect, expiration: 2 smoke tests passed.
- Short URL local CRUD without Redis
# 01: Empty Python evironment reproduces missing uvicorn.
- Create empty python venv with `python venv .venv-empty`
- Run `uvicorn main.app:app --reload` to reproduces missing environment situation
# 02: Image vs container, process lifecycle, container vs VM explained.
- Use `docker image ls` to list current Docker images in this device
- Run image `alpin:3.22` by creating container `seminar-concepts` with `docker run --name seminar-concepts alpine:3.22`
- See running containers with `docker ps`
- See all containers with `docker ps -a`, use `--filter` to filter containers
- Use `docker rm` to remove a container
- Use `docker logs` to read logs# 03: Backend image built; container start/stop/logs verified; DB not yet guaranteed.
