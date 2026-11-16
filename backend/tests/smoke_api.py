import json
import os
import time
import unittest
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


BASE = os.environ.get("SMOKE_BASE_URL", "http://localhost:8000").rstrip("/")
HTTP = build_opener(NoRedirect)


def request(method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(BASE + path, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        response = HTTP.open(req, timeout=10)
    except HTTPError as exc:
        response = exc  # 302/404/410 vẫn là kết quả HTTP cần assert.
    with response:
        return response.code, response.headers, response.read()


class UrlSmokeTests(unittest.TestCase):
    def setUp(self):
        self.codes = []

    def tearDown(self):
        for code in self.codes:
            request("DELETE", f"/api/urls/{code}")

    def create(self, seconds=3600):
        expiry = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        status, _, body = request("POST", "/api/urls", {
            "original_url": "https://example.com/docker-seminar",
            "expires_at": expiry.isoformat(),
        })
        self.assertEqual(status, 201, body)
        url = json.loads(body)
        self.codes.append(url["short_code"])
        return url["short_code"]

    def test_crud_redirect_and_clicks(self):
        code = self.create()
        status, headers, _ = request("GET", f"/{code}")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "https://example.com/docker-seminar")
        status, _, body = request("GET", "/api/urls")
        self.assertEqual(status, 200)
        item = next(item for item in json.loads(body) if item["short_code"] == code)
        self.assertEqual(item["click_count"], 1)
        self.assertEqual(request("DELETE", f"/api/urls/{code}")[0], 204)
        self.assertEqual(request("GET", f"/{code}")[0], 404)
        self.codes.remove(code)

    def test_expiration(self):
        code = self.create(seconds=3)
        time.sleep(4)
        self.assertEqual(request("GET", f"/{code}")[0], 410)


if __name__ == "__main__":
    unittest.main(verbosity=2)