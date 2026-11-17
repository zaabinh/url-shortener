"""Opt-in Compose checks using real HTTP, PostgreSQL and Redis.

Add --fallback with Redis already stopped. Only this process's records are changed.
"""
import json
import os
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone

import redis
from sqlalchemy import create_engine, text
from smoke_api import request


class DockerCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(os.environ["DATABASE_URL"])
        self.cache = redis.Redis.from_url(
            os.environ["REDIS_URL"], decode_responses=True,
            socket_connect_timeout=1, socket_timeout=1,
        )
        self.codes = []
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.cache.close)
        self.addCleanup(self.cleanup_urls)

    def cleanup_urls(self):
        for code in self.codes:
            self.assertIn(request("DELETE", f"/api/urls/{code}")[0], (204, 404))

    def create(self, seconds=3600):
        expiry = datetime.now(timezone.utc) + timedelta(seconds=seconds)
        status, _, body = request("POST", "/api/urls", {
            "original_url": "https://example.com/docker-cache",
            "expires_at": expiry.isoformat(),
        })
        self.assertEqual(status, 201, body)
        code = json.loads(body)["short_code"]
        self.codes.append(code)
        return code, expiry

    def clicks(self, code):
        with self.engine.connect() as connection:
            return connection.scalar(
                text("SELECT click_count FROM urls WHERE short_code=:code"), {"code": code},
            )

    def redirect(self, code):
        status, headers, _ = request("GET", f"/{code}")
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "https://example.com/docker-cache")
        self.assertEqual(headers["Cache-Control"], "no-store")


class RedisCacheTests(DockerCase):
    def test_miss_hit_and_delete_invalidation(self):
        code, _ = self.create()
        key = f"url:{code}"
        self.assertEqual(self.cache.exists(key), 0)
        self.redirect(code)
        self.assertEqual(self.cache.get(key), "https://example.com/docker-cache")
        self.assertGreater(self.cache.ttl(key), 0)
        self.assertLessEqual(self.cache.ttl(key), 3600)
        self.assertEqual(self.clicks(code), 1)
        self.redirect(code)
        self.assertEqual(self.clicks(code), 2)
        self.assertEqual(request("DELETE", f"/api/urls/{code}")[0], 204)
        self.assertEqual(self.cache.exists(key), 0)
        self.assertEqual(request("GET", f"/{code}")[0], 404)

    def test_expiration_does_not_increment_clicks(self):
        code, expiry = self.create(seconds=6)
        self.redirect(code)
        self.assertGreater(self.cache.ttl(f"url:{code}"), 0)
        self.assertLessEqual(self.cache.ttl(f"url:{code}"), 6)
        time.sleep(max(0, (expiry - datetime.now(timezone.utc)).total_seconds()) + 0.2)
        self.assertEqual(request("GET", f"/{code}")[0], 410)
        self.assertEqual(self.cache.exists(f"url:{code}"), 0)
        self.assertEqual(self.clicks(code), 1)

    def test_stale_cached_destination_is_rejected(self):
        code, _ = self.create()
        self.cache.set(f"url:{code}", "https://example.com/stale", ex=60)
        self.redirect(code)
        self.assertEqual(self.cache.get(f"url:{code}"), "https://example.com/docker-cache")
        self.assertEqual(self.clicks(code), 1)


class RedisFallbackTests(DockerCase):
    def test_redirects_and_counts_with_redis_unavailable(self):
        with self.assertRaises(redis.RedisError):
            self.cache.ping()
        code, _ = self.create()
        self.redirect(code)
        self.redirect(code)
        self.assertEqual(self.clicks(code), 2)
        self.assertEqual(request("DELETE", f"/api/urls/{code}")[0], 204)
        self.assertEqual(request("GET", f"/{code}")[0], 404)


if __name__ == "__main__":
    fallback = "--fallback" in sys.argv
    if fallback:
        sys.argv.remove("--fallback")
    unittest.main(defaultTest="RedisFallbackTests" if fallback else "RedisCacheTests", verbosity=2)
