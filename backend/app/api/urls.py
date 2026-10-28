
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.schemas.url import UrlCreate, UrlResponse
from app.services import url_service

router = APIRouter(prefix="/api/urls", tags=["urls"])

def _to_response(url) -> UrlResponse:
    return UrlResponse(
        short_code=url.short_code,
        short_url=settings.short_url(url.short_code),
        original_url=url.original_url,
        click_count=url.click_count,
        created_at=url.created_at,
        expired_at=url.expired_at,
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