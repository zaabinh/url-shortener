from fastapi import APIRouter, HTTPException, Path, Depends
from sqlalchemy.orm import Session
from fastapi.responses import RedirectResponse
from app.services import url_service
from app.db.database import get_db

router = APIRouter(tags=["redirect"])

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