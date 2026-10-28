
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.url import URLCreate, URLResponse
from app.services import url_service


router = APIRouter(tags=["URLs"])


# 1. CREATE: Tao URL rut gon
@router.post(
    "/api/urls",
    response_model=URLResponse,
    status_code=201,
)
def create_short_url(
    data: URLCreate,
    db: Session = Depends(get_db),
):
    try:
        url = url_service.create_url(
            db,
            str(data.original_url),
        )

        return URLResponse(
            id=url.id,
            original_url=url.original_url,
            short_code=url.short_code,
            short_url=url_service.build_short_url(url.short_code),
            click_count=url.click_count,
            created_at=url.created_at,
        )

    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Cannot create short URL",
        ) from exc

    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Database error while creating URL",
        ) from exc


# 2. READ: Lay danh sach URL
@router.get(
    "/api/urls",
    response_model=list[URLResponse],
)
def list_urls(
    db: Session = Depends(get_db),
):
    try:
        urls = url_service.get_urls(db)

        return [
            URLResponse(
                id=url.id,
                original_url=url.original_url,
                short_code=url.short_code,
                short_url=url_service.build_short_url(url.short_code),
                click_count=url.click_count,
                created_at=url.created_at,
            )
            for url in urls
        ]

    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Database error while listing URLs",
        ) from exc


# 3. DELETE: Xoa URL theo ID
@router.delete(
    "/api/urls/{url_id}",
    status_code=204,
)
def remove_url(
    url_id: int,
    db: Session = Depends(get_db),
):
    try:
        deleted = url_service.delete_url(db, url_id)

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="URL not found",
            )

        return Response(status_code=204)

    except HTTPException:
        raise

    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Database error while deleting URL",
        ) from exc