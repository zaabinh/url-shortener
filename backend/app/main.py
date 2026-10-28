
from fastapi import FastAPI

from app.api.urls import router as urls_router


app = FastAPI(
    title="URL Shortener API",
    version="1.0.0",
)

app.include_router(urls_router)


@app.get("/api/health", tags=["Health"])
def health_check():
    return {
        "status": "ok",
        "service": "url-shortener-backend",
    }
