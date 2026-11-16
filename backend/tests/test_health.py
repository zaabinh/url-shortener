def test_health(client):
    client.headers.clear()
    response = client.get("/app/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
