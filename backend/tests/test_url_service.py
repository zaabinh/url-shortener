import sqlite3
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core.config import Settings, settings
from app.db import database
from app.db.models import Url
from app.schemas.url import UrlCreate
from app.services import cache_service, url_service



def seed(db, code="taken", expiration=None):
    url = Url(short_code=code, original_url="https://example.com/original",
              expires_at=expiration or datetime.now(timezone.utc) + timedelta(days=1))
    db.add(url)
    db.commit()
    return url


def test_collision_retries_and_succeeds(db, monkeypatch):
    seed(db)
    codes = iter(["taken", "fresh-code"])
    monkeypatch.setattr(url_service, "generate_short_code", lambda _: next(codes))
    created = url_service.create_short_url(db, UrlCreate(original_url="https://example.com/new"))
    assert created.short_code == "fresh-code"
    assert len(list(db.scalars(select(Url)))) == 2


def test_collision_exhaustion_is_safe_503(client, db, monkeypatch):
    seed(db)
    generated = []
    def duplicate(_):
        generated.append("taken")
        return "taken"
    monkeypatch.setattr(url_service, "generate_short_code", duplicate)
    result = client.post("/api/urls", json={"original_url": "https://example.com/new"})
    assert result.status_code == 503
    assert len(generated) == url_service.MAX_ATTEMPTS


def test_non_collision_integrity_error_is_not_retried():
    db = MagicMock()
    db.commit.side_effect = IntegrityError("INSERT", {}, sqlite3.IntegrityError("NOT NULL constraint failed: urls.original_url"))
    with pytest.raises(IntegrityError):
        url_service.create_short_url(db, UrlCreate(original_url="https://example.com"))
    db.commit.assert_called_once()
    db.rollback.assert_called_once()


@pytest.mark.parametrize("constraint,expected", [("ix_urls_short_code", True), ("urls_short_code_key", True), ("urls_pkey", False)])
def test_postgres_collision_classification(constraint, expected):
    error = IntegrityError("INSERT", {}, SimpleNamespace(sqlstate="23505", diag=SimpleNamespace(constraint_name=constraint)))
    assert url_service._short_code_collision(error) is expected


def test_ttl_is_typed_and_validated(monkeypatch):
    monkeypatch.setenv("CACHE_TTL_SECONDS", "12")
    config = Settings(_env_file=None, DATABASE_URL="sqlite://", REDIS_URL="")
    assert config.cache_ttl_seconds == 12
    monkeypatch.setenv("CACHE_TTL_SECONDS", "-1")
    with pytest.raises(ValueError):
        Settings(_env_file=None, DATABASE_URL="sqlite://", REDIS_URL="")


def test_cache_miss_hit_and_delete_invalidation(client, db, monkeypatch):
    seed(db, expiration=datetime.now(timezone.utc) + timedelta(seconds=90))
    cache = MagicMock()
    cache.get.return_value = None
    monkeypatch.setattr(cache_service, "_client", cache)
    assert client.get("/taken", follow_redirects=False).status_code == 302
    args, kwargs = cache.set.call_args
    assert args == ("url:taken", "https://example.com/original")
    assert 0 < kwargs["ex"] <= 90
    cache.get.return_value = "https://example.com/original"
    assert client.get("/taken", follow_redirects=False).status_code == 302
    assert cache.set.call_count == 1
    assert db.scalar(select(Url.click_count)) == 2
    assert client.delete("/api/urls/taken").status_code == 204
    cache.delete.assert_called_with("url:taken")
    assert client.get("/taken", follow_redirects=False).status_code == 404


def test_stale_cache_cannot_redirect_a_reused_code(client, db, monkeypatch):
    seed(db)
    cache = MagicMock()
    cache.get.return_value = "https://old.example/deleted-record"
    monkeypatch.setattr(cache_service, "_client", cache)
    response = client.get("/taken", follow_redirects=False)
    assert response.headers["location"] == "https://example.com/original"
    cache.set.assert_called_once()


@pytest.mark.parametrize("method", ["get", "set", "delete"])
def test_redis_failures_fall_back_to_database(client, db, monkeypatch, method):
    seed(db)
    cache = MagicMock()
    cache.get.return_value = None
    getattr(cache, method).side_effect = redis.ConnectionError("unavailable")
    monkeypatch.setattr(cache_service, "_client", cache)
    assert client.get("/taken", follow_redirects=False).status_code == 302
    assert client.delete("/api/urls/taken").status_code == 204
    assert client.get("/taken", follow_redirects=False).status_code == 404


def test_cached_expired_record_does_not_redirect(client, db, monkeypatch):
    seed(db, expiration=datetime.now(timezone.utc) - timedelta(seconds=1))
    cache = MagicMock()
    cache.get.return_value = "https://example.com/original"
    monkeypatch.setattr(cache_service, "_client", cache)
    assert client.get("/taken", follow_redirects=False).status_code == 410
    cache.delete.assert_called_with("url:taken")
    assert db.scalar(select(Url.click_count)) == 0


def test_zero_ttl_disables_cache_writes(client, db, monkeypatch):
    seed(db)
    cache = MagicMock()
    cache.get.return_value = None
    monkeypatch.setattr(cache_service, "_client", cache)
    monkeypatch.setattr(settings, "cache_ttl_seconds", 0)
    assert client.get("/taken", follow_redirects=False).status_code == 302
    cache.set.assert_not_called()


def test_database_error_response_and_logs_hide_secrets(client, db, monkeypatch, caplog):
    def fail(*args, **kwargs):
        raise OperationalError("SELECT secret", {}, Exception("postgresql://user:secret-password@host"))
    monkeypatch.setattr(db, "scalars", fail)
    response = client.get("/api/urls")
    assert response.status_code == 503
    assert "secret-password" not in response.text + caplog.text


def test_db_dependency_rolls_back_and_closes(monkeypatch):
    db = MagicMock()
    monkeypatch.setattr(database, "SessionLocal", lambda: db)
    dependency = database.get_db()
    assert next(dependency) is db
    with pytest.raises(RuntimeError):
        dependency.throw(RuntimeError("failed"))
    db.rollback.assert_called_once()
    db.close.assert_called_once()
