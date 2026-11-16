# syntax=docker/dockerfile:1

FROM python:3.12-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt ./

RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install \
    --require-hashes \
    --only-binary=:all: \
    -r requirements.txt

COPY app ./app

FROM base AS test
COPY tests ./tests
CMD ["python", "tests/smoke_api.py"]

FROM base AS runtime
RUN useradd --create-home --uid 10001 appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]