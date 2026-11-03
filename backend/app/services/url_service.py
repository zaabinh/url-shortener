import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Url
from app.services import cache_service
from app.utils.short_code import generate_short_code

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 5

def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def create_url(db: Session, original_url: str, expired_at: datetime | None = None) -> Url:
    if expired_at is None:
        expired_at = datetime.now(timezone.utc) + timedelta(days=30)
    else:
        expired_at = _as_utc(expired_at)

    for attempt in range(MAX_ATTEMPTS):
        code = generate_short_code(settings.short_code_length)
        url = Url(
            short_code=code,
            original_url=original_url,
            expired_at=expired_at,
        )
        db.add(url)
        try:
            db.commit()
            db.refresh(url)
            logger.info("[DATABASE] Created %s -> %s", url.short_code, url.original_url)
            return url
        except IntegrityError:
            db.rollback()
            logger.warning(
                "[DATABASE] Collision on %s (attempt %d/%d), retrying...",
                code,
                attempt + 1,
                MAX_ATTEMPTS,
            )

    raise RuntimeError("Could not generate a unique short code after maximum attempts")

def list_urls(db: Session, limit: int = 20) -> list[Url]:
    return list(db.scalars(select(Url).order_by(Url.id.desc()).limit(limit)))

def get_url(db: Session, short_code: str) -> Url | None:
    return db.scalar(select(Url).where(Url.short_code == short_code))

def delete_url(db: Session, short_code: str) -> bool:
    url = get_url(db, short_code)
    if url is None:
        return False
    db.delete(url)
    db.commit()
    logger.info("[DATABASE] Deleted %s", short_code)
    # Cache Invalidation: Xóa cache ngay khi DB commit thành công
    cache_service.delete_cached_url(short_code)
    return True

def _increment_clicks(db: Session, short_code: str) -> bool:
    now = datetime.now(timezone.utc)
    # Atomic update click_count trong DB và kiểm tra link còn hạn
    stmt = (
        update(Url)
        .where(Url.short_code == short_code, Url.expired_at > now)
        .values(click_count=Url.click_count + 1)
        .execution_options(synchronize_session=False)
    )
    result = db.execute(stmt)
    db.commit()
    return result.rowcount > 0

def resolve_short_code(db: Session, short_code: str) -> tuple[str | None, int]:
    """
    Trả về (destination_url, status_code):
    - (url, 302): Thành công
    - (None, 410): Đã hết hạn (Expired)
    - (None, 404): Không tìm thấy (Not Found)
    """
    now = datetime.now(timezone.utc)

    # Kiểm tra Redis Cache
    cached_url = cache_service.get_cached_url(short_code)
    if cached_url is not None:
        if _increment_clicks(db, short_code):
            return cached_url, 302
        # Nếu atomic update thất bại (bị xóa hoặc vừa hết hạn), xóa stale cache
        cache_service.delete_cached_url(short_code)

    # Cache MISS hoặc Cache Stale -> Truy vấn PostgreSQL
    logger.info("[DATABASE] Query PostgreSQL: %s", short_code)
    url = get_url(db, short_code)
    if url is None:
        return None, 404

    # Kiểm tra thời hạn
    expired_at = _as_utc(url.expired_at)
    if expired_at <= now:
        logger.info("[DATABASE] Link %s expired at %s", short_code, url.expired_at)
        return None, 410

    if not _increment_clicks(db, short_code):
        current_url = get_url(db, short_code)
        if current_url is None:
            return None, 404
        if _as_utc(current_url.expired_at) <= datetime.now(timezone.utc):
            return None, 410
        return None, 404

    remaining_seconds = int((expired_at - now).total_seconds())
    ttl = min(settings.cache_ttl_seconds, remaining_seconds)
    cache_service.cache_url(short_code, url.original_url, ttl_seconds=ttl)

    return url.original_url, 302
