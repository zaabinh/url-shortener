# Database design

This document defines the planned PostgreSQL storage for the URL shortener. It matches the table currently declared in [init.sql](../docker/postgres/init.sql), including the required `expired_at` timestamp. The SQLAlchemy files are still placeholders, and the application does not yet access this table.

## Scope

One `urls` table stores each short-code mapping, an aggregate click count, and its lifetime. There are no user accounts or per-click analytics tables. Redis will be a disposable cache; PostgreSQL will remain the source of truth.

The baseline implementation guide predates `expired_at`. Its model, API, test, and seed examples must include this field when implemented. The behavior below is the intended implementation contract, not functionality already available.

## Table: `urls`

| Column | PostgreSQL type | Constraints/default | Meaning |
|---|---|---|---|
| `id` | `SERIAL` | Primary key; generated on insert | Internal record identifier |
| `short_code` | `VARCHAR(32)` | `NOT NULL`, `UNIQUE` | Public path segment, such as `aB3dE9x` |
| `original_url` | `VARCHAR(2048)` | `NOT NULL` | Absolute HTTP or HTTPS destination |
| `click_count` | `INTEGER` | `NOT NULL DEFAULT 0` | Number of successfully resolved redirect requests |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | Creation time |
| `expired_at` | `TIMESTAMPTZ` | `NOT NULL`; no default | Time at which the link stops redirecting |

```sql
CREATE TABLE IF NOT EXISTS urls (
    id           SERIAL PRIMARY KEY,
    short_code   VARCHAR(32)   NOT NULL UNIQUE,
    original_url VARCHAR(2048) NOT NULL,
    click_count  INTEGER       NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    expired_at   TIMESTAMPTZ   NOT NULL
);
```

This is a single-table design with no foreign keys. The public URL is derived as `BASE_URL + '/' + short_code`; it is not stored, so changing the deployment hostname does not require updating every record.

PostgreSQL's primary-key and unique constraints provide indexes on `id` and `short_code`. Do not add another ordinary index on `short_code` for the same lookup. No additional indexes are needed for the initial demo; consider an expiration index if scheduled cleanup becomes necessary.

## Validation and constraints

The existing SQL enforces column types, maximum string lengths, non-null values, and code uniqueness. The following rules must be enforced by the application; they are not additional constraints in the current initialization script:

- Accept only absolute HTTP/HTTPS destinations, up to 2,048 characters.
- Generate seven-character codes by default using ASCII letters and digits. Treat codes as case-sensitive, preserve their spelling, and check uniqueness before responding.
- Reserve route names such as `api`, `docs`, and `openapi.json` if custom aliases are introduced.
- Require a timezone-aware expiration timestamp later than the creation time. Normalize API timestamps to UTC.
- Do not allow clients to set `id`, `created_at`, or `click_count`.
- Do not reset or decrement click counts when a cached destination is used.

Two records may have the same `original_url`; only `short_code` is unique. This allows separate links with different creation times, expiration times, and counters. The database unique constraint must also handle concurrent code collisions: roll back and retry generation with a bounded retry count.

## Creation and expiration policy

Every record expires because `expired_at` is required. There is currently no configured default link lifetime. The planned create API must accept an explicit `expired_at` value and reject a missing, naive, or past timestamp. The frontend must collect that value before this contract can work end to end. Introducing an automatic lifetime later requires a documented backend configuration and matching tests; `CACHE_TTL_SECONDS` is a cache setting, not a link lifetime.

Example planned create request:

```json
{
  "original_url": "https://docs.docker.com/get-started/",
  "expired_at": "2030-01-01T00:00:00Z"
}
```

The current frontend sends only `original_url`, so it must be updated alongside the future request schema. The response should include `short_code`, derived `short_url`, `original_url`, `click_count`, `created_at`, and `expired_at`.

Expiration is evaluated at request time:

| Condition | Planned result |
|---|---|
| Code exists and `expired_at > now()` | Count the resolution and return HTTP 302 with the destination in `Location` |
| Code does not exist | HTTP 404 |
| Code exists and `expired_at <= now()` | HTTP 410; do not increment clicks |
| Record was deleted | HTTP 404; remove any cached destination |

Expired rows remain available for the recent-links list until explicitly deleted. The list should display their expired state and order records by `created_at DESC, id DESC` for deterministic results. Automatic cleanup is outside the initial scope.

## Read and write operations

| Operation | Database behavior |
|---|---|
| Create | Insert a unique code, destination, and explicit expiration; database supplies the other defaults |
| List | Return a bounded page ordered newest first; include expiration information |
| Redirect | Resolve an active code and atomically increment its counter |
| Delete | Delete by code, commit, and invalidate its Redis key |

Use an atomic database increment rather than reading a counter into Python and writing it back. A planned redirect query can resolve and count in one statement:

```sql
UPDATE urls
SET click_count = click_count + 1
WHERE short_code = :short_code
  AND expired_at > NOW()
RETURNING original_url, expired_at;
```

The parameters above are SQLAlchemy-style bound parameters, not literal values to paste into `psql`. Commit the transaction before returning the redirect. If no row is returned, look up the code to distinguish a missing record from an expired one. Click counts measure server-side resolutions; they cannot prove that the destination loaded in the browser.

## Redis cache contract — Phase 8

- Key: `url:{short_code}`.
- Value: destination URL and its expiration timestamp; do not use a cached click counter as the authoritative count.
- Cache misses read PostgreSQL and cache only active records.
- TTL is the smaller of `CACHE_TTL_SECONDS` and the link's remaining lifetime, rounded down to whole seconds. Skip caching when that result is less than one second.
- Cache hits still check expiration and atomically increment PostgreSQL's counter, conditional on the record still existing and being active. If the update affects no row, discard the cache entry and resolve the missing/expired state.
- After a successful delete, invalidate the key. If invalidation fails, the database existence check on redirects prevents a stale cache entry from redirecting a deleted code.
- When Redis is unavailable, resolve through PostgreSQL. Counters and expiration semantics must remain the same.

## Schema ownership and initialization

In Phase 2, implement `backend/app/db/models.py` and session management to match this document. SQLAlchemy startup creation is suitable for the seminar's first tables. Later, wire `docker/postgres/init.sql` into PostgreSQL's initialization directory through Compose.

Initialization scripts run only when the PostgreSQL data directory is empty. `CREATE TABLE IF NOT EXISTS` and SQLAlchemy `create_all()` do not add `expired_at` to an existing table. Any existing schema without that field needs an explicit migration, including a backfill for existing rows, before enforcing `NOT NULL`. Recreating demo storage is an alternative only when discarding its data is intended.

No seed row currently exists in `init.sql`. Any future demo row, including the guide's suggested `/docker` link, must provide an expiration timestamp and remain active for the demo.

## Implementation acceptance checks

- [ ] ORM and initialization SQL have matching columns, defaults, and uniqueness rules.
- [ ] Valid records persist across backend restarts.
- [ ] Duplicate destinations are allowed; duplicate codes are rejected and retried safely.
- [ ] Invalid URLs and missing/past/naive expiration values are rejected.
- [ ] Newly created URLs start with zero clicks.
- [ ] Active redirects return 302 and increment the counter under concurrent requests.
- [ ] Missing codes return 404; expired codes return 410 without incrementing clicks.
- [ ] Recent links are ordered consistently and identify expired entries.
- [ ] Deletion prevents redirects even when cache invalidation fails.
- [ ] Cache hits, misses, expiry, and Redis outages preserve database behavior.

Return to the [README](../README.md) or the [implementation guide](IMPLEMENTATION_GUIDE.md).
