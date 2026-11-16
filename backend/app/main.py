import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.api.urls import router as urls_router
from app.core.config import settings
from app.services.url_service import CodeGenerationError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = FastAPI(title="URL Shortener API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)
app.include_router(urls_router)


@app.exception_handler(SQLAlchemyError)
def database_error(request: Request, error: SQLAlchemyError):
    # Driver exception text can contain SQL, URL data or connection credentials.
    logger.error("Database request failed: %s", type(error).__name__)
    code = 409 if isinstance(error, IntegrityError) else 503
    message = "Database conflict" if code == 409 else "Database temporarily unavailable"
    return JSONResponse(status_code=code, content={"detail": message}, headers={"Cache-Control": "no-store"})


@app.exception_handler(CodeGenerationError)
def code_generation_error(request: Request, error: CodeGenerationError):
    return JSONResponse(status_code=503, content={"detail": "Could not allocate a short URL; try again"}, headers={"Retry-After": "1"})


@app.get("/app/health")
def health_check():
    return {"status": "healthy"}
