from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.db.models import URLModel
from app.schemas.url import URLCreate
from app.utils.short_code import generate_short_code

def create_short_url(db: Session, payload: URLCreate, base_url: str) -> URLModel:
    """Tạo short URL với cơ chế retry khi trùng lặp short_code."""
    max_retries = 5
    for _ in range(max_retries):
        short_code = generate_short_code()
        db_url = URLModel(
            original_url=str(payload.original_url),
            short_code=short_code,
            expired_at=payload.expired_at,
            click_count=0,
            active=True
        )
        db.add(db_url)
        try:
            db.commit()
            db.refresh(db_url)
            return db_url
        except IntegrityError:
            db.rollback()
            continue
            
    raise RuntimeError("Không thể tạo unique short_code sau nhiều lần thử do va chạm dữ liệu.")