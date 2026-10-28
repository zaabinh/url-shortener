import logging
import redis
from app.core.config import settings

logger = logging.getLogger(__name__)

_client = (
    redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
    if settings.redis_url
    else None
)

def _key(short_code: str) -> str:
    return f"url:{short_code}"

def get_cached_url(short_code: str) -> str | None:
    if _client is None:
        return None
    try:
        val = _client.get(_key(short_code))
    except redis.RedisError as exc:
        logger.warning("[REDIS] Unavailable (%s), falling back to PostgreSQL", exc)
        return None

    if val is None:
        logger.info("[REDIS] Cache MISS: %s", short_code)
    else:
        logger.info("[REDIS] Cache HIT: %s", short_code)
    return val

def cache_url(short_code: str, original_url: str, ttl_seconds: int | None = None) -> None:
    if _client is None:
        return
    ttl = ttl_seconds if ttl_seconds is not None else settings.cache_ttl_seconds
    if ttl <= 0:
        return
    try:
        _client.set(_key(short_code), original_url, ex=ttl)
        logger.info("[REDIS] Cached: %s (TTL %ss)", short_code, ttl)
    except redis.RedisError as exc:
        logger.warning("[REDIS] Could not cache %s (%s)", short_code, exc)

def delete_cached_url(short_code: str) -> None:
    """Cache invalidation khi URL bị xóa hoặc hết hạn."""
    if _client is None:
        return
    try:
        _client.delete(_key(short_code))
        logger.info("[REDIS] Invalidated: %s", short_code)
    except redis.RedisError as exc:
        logger.warning("[REDIS] Could not invalidate %s (%s)", short_code, exc)