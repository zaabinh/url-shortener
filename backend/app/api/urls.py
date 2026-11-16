from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.url import UrlCreate, UrlResponse
from app.services import url_service

router = APIRouter(prefix="/api/urls", tags=["urls"])


@router.post(
    "", response_model=UrlResponse, status_code=status.HTTP_201_CREATED,
    responses={
        409: {"description": "Database constraint conflict"},
        503: {"description": "Database unavailable or short code allocation exhausted"},
    },
)
def create_url(payload: UrlCreate, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return url_service.create_short_url(db, payload)


@router.get(
    "", response_model=list[UrlResponse],
    responses={503: {"description": "Database temporarily unavailable"}},
)
def list_urls(
    response: Response,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return url_service.list_urls(db, limit, offset)


@router.delete(
    "/{short_code}", status_code=status.HTTP_204_NO_CONTENT,
    responses={
        404: {"description": "URL not found"},
        503: {"description": "Database temporarily unavailable"},
    },
)
def delete_url(short_code: str = Path(min_length=1, max_length=32), db: Session = Depends(get_db)):
    if not url_service.delete_url(db, short_code):
        raise HTTPException(404, "URL not found")
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get(
    "/{short_code}", response_class=RedirectResponse, status_code=302,
    responses={
        302: {"description": "Redirect to the original URL"},
        404: {"description": "Short URL not found"},
        410: {"description": "URL has expired"},
        503: {"description": "Database temporarily unavailable"},
    },
)
def redirect_to_url(short_code: str = Path(min_length=1, max_length=32), db: Session = Depends(get_db)):
    destination, result_status = url_service.resolve_short_code(db, short_code)
    if result_status == 404:
        raise HTTPException(404, "Short URL not found")
    if result_status == 410:
        raise HTTPException(410, "URL has expired")
    return RedirectResponse(destination, status_code=302, headers={"Cache-Control": "no-store"})
