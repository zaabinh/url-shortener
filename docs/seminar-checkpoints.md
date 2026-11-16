# 00: Local CRUD, redirect, expiration: 2 smoke tests passed.
- Short URL local CRUD without Redis
# 01: Empty Python evironment reproduces missing uvicorn.
- Create empty python venv with `python venv .venv-empty`
- Run `uvicorn main.app:app --reload` to reproduces missing environment situation
# 02: Image vs container, process lifecycle, container vs VM explained.
- 