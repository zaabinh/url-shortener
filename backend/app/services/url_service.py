from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.db.models import URL
from app.schemas.url import URLCreate
from app.utils.short_code import generate_short_code


def create_short_url(db: Session, payload: URLCreate, base_url: str) -> URL:
    """Tạo short URL với cơ chế retry an toàn khi trùng lặp short_code."""
    max_retries = 5
    for attempt in range(max_retries):
        short_code = generate_short_code()
        db_url = URL(
            original_url=str(payload.original_url),
            short_code=short_code,
            expired_at=payload.expired_at,
            click_count=0,
        )
        db.add(db_url)
        try:
            db.commit()
            db.refresh(db_url)
            return db_url
        except IntegrityError as e:
            db.rollback()
            if attempt == max_retries - 1:
                raise RuntimeError(f"Database integrity error during creation: {str(e)}")
            continue

    raise RuntimeError("Không thể tạo unique short_code sau nhiều lần thử do va chạm dữ liệu.")