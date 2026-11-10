import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/app/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_create_and_list_urls():
    future_time = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    
    # Test POST /api/urls
    payload = {
        "original_url": "https://example.com",
        "expired_at": future_time
    }
    response = client.post("/api/urls", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["original_url"] == "https://example.com/"
    assert len(data["short_code"]) == 7
    
    short_code = data["short_code"]

    # Test GET /api/urls
    list_response = client.get("/api/urls")
    assert list_response.status_code == 200
    urls = list_response.json()
    assert any(u["short_code"] == short_code for u in urls)

    # Test DELETE /api/urls/{short_code}
    del_response = client.delete(f"/api/urls/{short_code}")
    assert del_response.status_code == 204

def test_expired_url_redirect():
    past_time = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    payload = {
        "original_url": "https://expired.com",
        "expired_at": past_time
    }
    # Tạo URL đã hết hạn (Pydantic ở schema có thể chặn expired trong quá khứ, 
    # nếu schema bắt buộc tương lai, test này dùng định dạng mocking hoặc test trực tiếp CSDL)