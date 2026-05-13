from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime
from threading import Lock
from typing import Any, Protocol

log = logging.getLogger(__name__)


def build_doc_cache_key(*, listing_id: str, time_start: datetime, body_fingerprint: str) -> str:
    """
    Key pattern from requirements: simulation:{listing_id}:{date}:{hash}
    """
    day = time_start.strftime("%Y-%m-%d")
    h = hashlib.sha256(body_fingerprint.encode()).hexdigest()[:24]
    return f"simulation:{listing_id}:{day}:{h}"


class CacheStore(Protocol):
    def get(self, key: str) -> dict[str, Any] | None: ...
    def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None: ...


class MemoryCache:
    def __init__(self) -> None:
        self._data: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = Lock()

    def get(self, key: str) -> dict[str, Any] | None:
        now = time.time()
        with self._lock:
            hit = self._data.get(key)
            if not hit:
                return None
            exp, payload = hit
            if exp < now:
                del self._data[key]
                return None
            return dict(payload)

    def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        with self._lock:
            self._data[key] = (time.time() + ttl_seconds, dict(value))


class RedisCache:
    def __init__(self, url: str) -> None:
        import redis

        self._r = redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=2.0)

    def ping(self) -> bool:
        try:
            return bool(self._r.ping())
        except Exception:  # noqa: BLE001
            return False

    def get(self, key: str) -> dict[str, Any] | None:
        try:
            raw = self._r.get(key)
        except Exception as e:  # noqa: BLE001
            log.warning("redis get failed: %s", e)
            return None
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        try:
            self._r.setex(key, ttl_seconds, json.dumps(value, default=str))
        except Exception as e:  # noqa: BLE001
            log.warning("redis set failed: %s", e)


def create_cache_store(redis_url: str | None) -> CacheStore:
    if redis_url:
        try:
            return RedisCache(redis_url)
        except Exception as e:  # noqa: BLE001
            log.warning("redis unavailable (%s); using in-memory cache", e)
    return MemoryCache()
