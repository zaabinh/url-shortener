# Database design

PostgreSQL is the source of truth. backend/app/db/models.py defines a single urls table, with no user account or per-click analytics tables.

| Column | Type | Constraints/default |
|---|---|---|
| id | UUID | Primary key; Python uuid4 |
| short_code | VARCHAR(32) | NOT NULL, unique index |
| original_url | VARCHAR(2048) | NOT NULL |
| click_count | INTEGER | NOT NULL; ORM default 0 |
| created_at | TIMESTAMPTZ | Server default NOW(); nullable for legacy records |
| expires_at | TIMESTAMPTZ | NOT NULL |

UUID and click_count defaults run through the ORM; raw SQL inserts must supply those values. Initialize a new database using Base.metadata.create_all as described in README. This does not migrate existing tables.

## URL lifecycle

Only HTTP/HTTPS destinations up to 2048 characters are accepted. Explicit expires_at must include a timezone and be in the future; omitted expiration defaults to 30 days. Times are normalized to UTC. Legacy naive timestamps are treated as UTC when evaluating expiration.

Multiple links may share a destination. Short codes are case-sensitive and unique. On code collision, creation rolls back and retries up to 10 times. Other integrity failures are not retried as collisions.

Redirects at /api/urls/{short_code} use a conditional UPDATE with RETURNING to check expiration, increment clicks and retrieve the destination. Missing links return 404; expired links return 410 without increasing clicks. SQL increments avoid lost concurrent updates.

Lists sort by created_at descending, then id descending, with limit/offset pagination. Pages can shift when records are inserted or removed between requests. Deletion commits the database change before invalidating cache.

## Redis

The url:{short_code} key stores the destination. TTL cannot exceed either the remaining URL lifetime or CACHE_TTL_SECONDS. TTL 0 skips cache writes. Cache hits still perform a conditional database UPDATE and verify the cached destination. Stale cache entries are discarded. Redis failures fall back to PostgreSQL; database failures return 503.

No ownership columns are required. Older SERIAL or expired_at schemas need a data-preserving migration before using the current model.
