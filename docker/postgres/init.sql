-- Runs only when the PostgreSQL data volume is empty (first start).
-- Must stay in sync with backend/app/db/models.py.
CREATE TABLE IF NOT EXISTS urls (
    id           SERIAL PRIMARY KEY,
    short_code   VARCHAR(32)   NOT NULL UNIQUE,
    original_url VARCHAR(2048) NOT NULL,
    click_count  INTEGER       NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    expired_at   TIMESTAMPTZ   NOT NULL 

);