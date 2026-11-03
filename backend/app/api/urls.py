from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.schemas.url import UrlCreate, UrlResponse
from app.services import url_service

router = APIRouter(prefix="/api/urls", tags=["urls"])
redirect_router = APIRouter(tags=["redirect"])

def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def _to_response(url) -> UrlResponse:
    return UrlResponse(
        short_code=url.short_code,
        short_url=settings.short_url(url.short_code),
        original_url=url.original_url,
        click_count=url.click_count,
        created_at=_as_utc(url.created_at) if hasattr(url, "created_at") and url.created_at else datetime.now(timezone.utc),
        expired_at=_as_utc(url.expired_at),
    )

@router.post("", response_model=UrlResponse, status_code=status.HTTP_201_CREATED)
def create_url(payload: UrlCreate, db: Session = Depends(get_db)):
    url = url_service.create_url(db, str(payload.original_url), payload.expired_at)
    return _to_response(url)

@router.get("", response_model=list[UrlResponse])
def list_urls(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    return [_to_response(u) for u in url_service.list_urls(db, limit)]

@router.delete("/{short_code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_url(short_code: str, db: Session = Depends(get_db)):
    if not url_service.delete_url(db, short_code):
        raise HTTPException(status_code=404, detail="URL not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@redirect_router.get("/{short_code}")
def redirect_to_original(short_code: str, db: Session = Depends(get_db)):
    destination_url, status_code = url_service.resolve_short_code(db, short_code)
    if status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Short URL not found")
    if status_code == 410:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Short URL has expired")
    return RedirectResponse(destination_url, status_code=status.HTTP_302_FOUND)
