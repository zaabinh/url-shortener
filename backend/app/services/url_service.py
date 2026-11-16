import logging
import sqlite3
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete as sql_delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Url
from app.schemas.url import RESERVED_SHORT_CODES, UrlCreate
from app.services import cache_service
from app.utils.short_code import generate_short_code

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 10


class CodeGenerationError(Exception):
    pass


class ShortCodeTaken(Exception):
    pass


def _as_utc(value: datetime) -> datetime:
    # Legacy naive timestamps are assumed to have been stored in UTC.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _short_code_collision(error: IntegrityError) -> bool:
    original = error.orig
    if getattr(original, "sqlstate", None) == "23505":
        constraint = getattr(getattr(original, "diag", None), "constraint_name", None)
        return constraint in {"ix_urls_short_code", "urls_short_code_key", "uq_urls_short_code"}
    return isinstance(original, sqlite3.IntegrityError) and str(original) == "UNIQUE constraint failed: urls.short_code"


def create_short_url(db: Session, payload: UrlCreate) -> Url:
    expiration = payload.expires_at or datetime.now(timezone.utc) + timedelta(days=30)
    custom_code = payload.short_code
    attempts = 1 if custom_code is not None else MAX_ATTEMPTS
    for attempt in range(attempts):
        short_code = custom_code or generate_short_code(settings.short_code_length)
        if short_code.lower() in RESERVED_SHORT_CODES:
            continue
        url = Url(short_code=short_code,
                  original_url=str(payload.original_url),
                  created_at=datetime.now(timezone.utc), expires_at=_as_utc(expiration))
        db.add(url)
        try:
            db.commit()
        except IntegrityError as error:
            db.rollback()
            if not _short_code_collision(error):
                raise
            if custom_code is not None:
                raise ShortCodeTaken() from error
            logger.warning("Short code collision (attempt %d/%d)", attempt + 1, attempts)
            continue
        db.refresh(url)
        logger.info("[DATABASE] Created %s", url.short_code)
        return url
    raise CodeGenerationError("Could not allocate a short code")


def list_urls(db: Session, limit: int = 20, offset: int = 0) -> list[Url]:
    return list(db.scalars(
        select(Url)
        .order_by(Url.created_at.desc(), Url.id.desc()).offset(offset).limit(limit)
    ))


def delete_url(db: Session, short_code: str) -> bool:
    code = db.execute(
        sql_delete(Url).where(Url.short_code == short_code)
        .returning(Url.short_code).execution_options(synchronize_session=False)
    ).scalar_one_or_none()
    db.commit()
    if code is None:
        return False
    cache_service.delete_cached_url(code)
    return True


def resolve_short_code(db: Session, short_code: str) -> tuple[str | None, int]:
    cached = cache_service.get_cached_url(short_code)
    click = (
        update(Url).where(Url.short_code == short_code)
        .values(click_count=Url.click_count + 1)
        .execution_options(synchronize_session=False)
    )
    if cached is not None:
        # Validate cached mappings too: a deleted/reused code must not use an old destination.
        matched = db.execute(
            click.where(Url.original_url == cached, Url.expires_at > datetime.now(timezone.utc))
            .returning(Url.short_code)
        ).scalar_one_or_none()
        db.commit()
        if matched is not None:
            return cached, 302
        cache_service.delete_cached_url(short_code)

    logger.info("[DATABASE] Query PostgreSQL: %s", short_code)
    # The guarded UPDATE returns a fresh mapping and increments clicks exactly once.
    row = db.execute(
        click.where(Url.expires_at > datetime.now(timezone.utc))
        .returning(Url.original_url, Url.expires_at)
    ).first()
    db.commit()
    if row is None:
        cache_service.delete_cached_url(short_code)
        # Select a column, not a stale ORM object when expire_on_commit=False.
        expiration = db.scalar(select(Url.expires_at).where(Url.short_code == short_code))
        expired = expiration is not None and _as_utc(expiration) <= datetime.now(timezone.utc)
        return None, 410 if expired else 404
    destination, expiration = row
    # A reused code must never redirect to a stale cached destination.
    if cached != destination:
        remaining = int((_as_utc(expiration) - datetime.now(timezone.utc)).total_seconds())
        cache_service.cache_url(short_code, destination, ttl_seconds=min(settings.cache_ttl_seconds, remaining))
    return destination, 302
