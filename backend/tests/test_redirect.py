from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select

from app.db.models import Url


def add_url(db, code="redirect", expires=None):
    row = Url(short_code=code, original_url="https://example.com/destination", expires_at=expires or datetime.now(timezone.utc)+timedelta(days=1))
    db.add(row)
    db.commit()
    return row


@pytest.mark.parametrize("aware", [True, False])
def test_public_redirect_increments_clicks(client, db, aware):
    expiry = datetime.now(timezone.utc) + timedelta(days=1)
    if not aware:
        expiry = expiry.replace(tzinfo=None)
    add_url(db, expires=expiry)
    client.headers.clear()
    response = client.get("/redirect", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "https://example.com/destination"
    assert response.headers["cache-control"] == "no-store"
    assert db.scalar(select(Url.click_count).where(Url.short_code == "redirect")) == 1


def test_expired_redirect_never_increments(client, db):
    add_url(db, expires=datetime.now(timezone.utc)-timedelta(seconds=1))
    assert client.get("/redirect", follow_redirects=False).status_code == 410
    assert db.scalar(select(Url.click_count)) == 0


def test_missing_redirect(client):
    assert client.get("/missing", follow_redirects=False).status_code == 404


def test_delete_between_lookup_and_update_does_not_redirect(client, db):
    row = add_url(db)
    engine = db.get_bind()
    removed = False
    def delete_before_update(connection, cursor, statement, parameters, context, executemany):
        nonlocal removed
        if not removed and statement.lstrip().startswith("UPDATE urls SET click_count"):
            removed = True
            connection.exec_driver_sql("DELETE FROM urls WHERE short_code = 'redirect'")
    event.listen(engine, "before_cursor_execute", delete_before_update)
    try:
        assert client.get("/redirect", follow_redirects=False).status_code == 404
        assert removed
    finally:
        event.remove(engine, "before_cursor_execute", delete_before_update)


def test_many_redirects_have_exact_click_count(client, db):
    add_url(db)
    for _ in range(12):
        assert client.get("/redirect", follow_redirects=False).status_code == 302
    assert db.scalar(select(Url.click_count)) == 12
