
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import URL
from app.utils.short_code import generate_short_code


def create_url(db: Session, original_url: str) -> URL:
    for _ in range(10):
        url = URL(
            original_url=original_url,
            short_code=generate_short_code(),
            click_count=0,
        )

        db.add(url)

        try:
            db.commit()
            db.refresh(url)
            return url

        except IntegrityError:
            db.rollback()

    raise RuntimeError("Cannot generate a unique short code")


def get_urls(db: Session) -> list[URL]:
    statement = select(URL).order_by(URL.id.desc())
    return list(db.scalars(statement).all())



def delete_url(db: Session, url_id: int) -> bool:
    try:
        url = db.query(URL).filter(URL.id == url_id).first()

        if url is None:
            return False

        db.delete(url)
        db.commit()
        return True

    except Exception:
        db.rollback()
        raise


def get_url_by_code(db: Session, short_code: str) -> URL | None:
    statement = select(URL).where(URL.short_code == short_code)
    return db.scalars(statement).first()


def increment_click_count(db: Session, url: URL) -> None:
    try:
        url.click_count += 1
        db.commit()
        db.refresh(url)

    except Exception:
        db.rollback()
        raise


def build_short_url(short_code: str) -> str:
    return f"{settings.BASE_URL.rstrip('/')}/{short_code}"
