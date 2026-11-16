from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db.models import Url


def payload(**overrides):
    return {"original_url": "https://example.com/long", "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(), **overrides}


def test_create_list_and_delete(client, db):
    response = client.post("/api/urls", json=payload())
    assert response.status_code == 201
    item = response.json()
    assert len(item["short_code"]) == 7
    assert item["active"] is True
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/urls").json()[0]["id"] == item["id"]
    assert client.delete("/api/urls/" + item["short_code"]).status_code == 204
    assert client.delete("/api/urls/" + item["short_code"]).status_code == 404


@pytest.mark.parametrize("overrides", [
    {"original_url": "javascript:alert(1)"}, {"original_url": "ftp://example.com"},
    {"original_url": "https://example.com/" + "a" * 2100},
    {"expires_at": "2099-01-01T00:00:00"},
    {"expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()},
])
def test_rejects_invalid_input(client, overrides):
    assert client.post("/api/urls", json=payload(**overrides)).status_code == 422


def test_unknown_expiration_field_is_not_silently_ignored(client):
    assert client.post("/api/urls", json={"original_url": "https://example.com", "expired_at": "2099-01-01T00:00:00Z"}).status_code == 422


def test_default_expiration(client):
    response = client.post("/api/urls", json={"original_url": "https://example.com"})
    assert response.status_code == 201
    expires = datetime.fromisoformat(response.json()["expires_at"]).replace(tzinfo=timezone.utc)
    assert timedelta(days=29) < expires - datetime.now(timezone.utc) <= timedelta(days=30)


def test_expired_response_is_inactive(client, db):
    code = client.post("/api/urls", json=payload()).json()["short_code"]
    row = db.scalar(select(Url).where(Url.short_code == code))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.get("/api/urls").json()[0]["active"] is False


def test_pagination_is_ordered_by_creation_time(client, db):
    now = datetime.now(timezone.utc)
    db.add_all([Url(short_code=f"page{i}", original_url="https://example.com", created_at=now+timedelta(seconds=i), expires_at=now+timedelta(days=1)) for i in range(5)])
    db.commit()
    assert [row["short_code"] for row in client.get("/api/urls?limit=2&offset=1").json()] == ["page3", "page2"]
    for query in ["limit=101", "limit=0", "offset=-1"]:
        assert client.get("/api/urls?" + query).status_code == 422
