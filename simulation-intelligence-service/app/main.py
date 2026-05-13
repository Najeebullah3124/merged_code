from __future__ import annotations

import hashlib
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.adapters.upstream import fetch_parallel_listing_context
from app.cache_store import RedisCache, build_doc_cache_key, create_cache_store
from app.config import get_settings
from app.engine.core import default_listing_context, run_simulation
from app.middleware.request_context import RequestContextMiddleware
from app.observability import metrics

log = logging.getLogger(__name__)

_http_client: httpx.AsyncClient | None = None
_cache_backend: Any = None


class SimulationRunBody(BaseModel):
    listing_id: str = Field(..., min_length=1, max_length=128)
    time_range: tuple[str, str] = Field(..., description="ISO8601 start and end")
    price_scenarios: list[float] = Field(..., min_length=1, max_length=48)
    vertical: str = Field("lodging", pattern="^(lodging|car)$")
    demand_shift_pct: float = Field(0.0, ge=-0.9, le=2.0)
    risk_shift_pct: float = Field(0.0, ge=-0.9, le=2.0)
    use_upstream_listing: bool = Field(
        True,
        description="Load min/max/base from Smart Pricing (lodging) when URL configured.",
    )
    use_upstream_commission: bool = Field(
        True,
        description="When URL configured, load Smart Commission Engine pricing hints in parallel.",
    )


def _fingerprint(body: SimulationRunBody) -> str:
    raw = body.model_dump()
    blob = json.dumps(raw, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def _setup_logging() -> None:
    s = get_settings()
    logging.basicConfig(
        level=getattr(logging, s.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _http_client, _cache_backend
    _setup_logging()
    s = get_settings()
    _cache_backend = create_cache_store(s.redis_url)
    _http_client = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        timeout=httpx.Timeout(s.request_timeout_seconds),
    )
    log.info(
        "SIS started version=%s redis=%s cache_ttl=%s",
        s.service_version,
        "on" if s.redis_url else "off",
        s.cache_ttl_seconds,
    )
    yield
    if _http_client:
        await _http_client.aclose()
    log.info("SIS shutdown complete")


_settings_init = get_settings()
app = FastAPI(
    title="Simulation Intelligence Service",
    version=_settings_init.service_version,
    lifespan=lifespan,
)

app.add_middleware(RequestContextMiddleware)

limiter = Limiter(key_func=get_remote_address, default_limits=[])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_origins = [o.strip() for o in _settings_init.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins if _origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_PUBLIC = Path(__file__).resolve().parent.parent / "public"
if _PUBLIC.is_dir():
    app.mount("/ui/static", StaticFiles(directory=str(_PUBLIC)), name="static")


def _parse_iso(s: str) -> datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _cache_get_for_body(body: SimulationRunBody) -> dict[str, Any] | None:
    s = get_settings()
    if s.cache_ttl_seconds <= 0 or not _cache_backend:
        return None
    start = _parse_iso(body.time_range[0])
    key = build_doc_cache_key(
        listing_id=body.listing_id,
        time_start=start,
        body_fingerprint=_fingerprint(body),
    )
    hit = _cache_backend.get(key)
    if hit is not None and s.metrics_enabled:
        back = "redis" if isinstance(_cache_backend, RedisCache) else "memory"
        metrics.CACHE_HITS.labels(backend=back).inc()
    return hit


def _cache_set_for_body(body: SimulationRunBody, payload: dict[str, Any]) -> None:
    s = get_settings()
    if s.cache_ttl_seconds <= 0 or not _cache_backend:
        return
    start = _parse_iso(body.time_range[0])
    key = build_doc_cache_key(
        listing_id=body.listing_id,
        time_start=start,
        body_fingerprint=_fingerprint(body),
    )
    p = {k: v for k, v in payload.items() if k != "cached"}
    _cache_backend.set(key, p, s.cache_ttl_seconds)


@app.get("/health")
@app.get("/v1/simulation/health")
def health() -> dict[str, Any]:
    s = get_settings()
    return {
        "status": "ok",
        "service": "simulation-intelligence",
        "version": s.service_version,
        "capabilities": {
            "sync_interval_model": True,
            "risk_availability_coupling": True,
            "feedback_loop": True,
            "parallel_upstream_adapters": True,
            "redis_cache": bool(s.redis_url),
            "prometheus_metrics": s.metrics_enabled,
        },
    }


@app.get("/ready")
def ready() -> dict[str, Any]:
    """Kubernetes readiness: Redis must ping when configured."""
    s = get_settings()
    out: dict[str, Any] = {"status": "ready", "redis": "disabled"}
    if s.redis_url:
        if isinstance(_cache_backend, RedisCache):
            ok = _cache_backend.ping()
            out["redis"] = "ok" if ok else "down"
            if not ok:
                raise HTTPException(status_code=503, detail="redis_unreachable")
        else:
            out["redis"] = "memory_fallback"
    return out


@app.get("/metrics")
def prometheus_metrics():
    if not get_settings().metrics_enabled:
        raise HTTPException(status_code=404, detail="metrics_disabled")
    body, ctype = metrics.metrics_body()
    return Response(content=body, media_type=ctype)


async def simulation_run(request: Request, body: SimulationRunBody) -> dict[str, Any]:
    s = get_settings()
    cached = _cache_get_for_body(body)
    if cached is not None:
        out = dict(cached)
        out["cached"] = True
        out["vertical"] = body.vertical
        if s.metrics_enabled:
            metrics.SIMULATION_RUNS.labels(cached="true", vertical=body.vertical).inc()
        return out

    if s.metrics_enabled and s.cache_ttl_seconds > 0:
        back = "redis" if isinstance(_cache_backend, RedisCache) else "memory"
        metrics.CACHE_MISSES.labels(backend=back).inc()

    try:
        start = _parse_iso(body.time_range[0])
        end = _parse_iso(body.time_range[1])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid time_range: {e}") from e

    if end <= start:
        raise HTTPException(status_code=400, detail="time_range end must be after start")

    settings = get_settings()
    listing_ctx = None
    comm_meta: dict[str, Any] | None = None
    if body.use_upstream_listing and body.vertical == "lodging" and _http_client:
        listing_ctx, comm_meta = await fetch_parallel_listing_context(
            _http_client,
            settings,
            body.listing_id,
            include_commission=body.use_upstream_commission,
        )
    elif body.use_upstream_commission and _http_client:
        _, comm_meta = await fetch_parallel_listing_context(
            _http_client,
            settings,
            body.listing_id,
            include_commission=True,
        )

    if listing_ctx is None and comm_meta and comm_meta.get("markup") is not None:
        listing_ctx = default_listing_context(body.listing_id)
        try:
            listing_ctx.commission_markup = float(comm_meta["markup"])
        except (TypeError, ValueError):
            pass
        if comm_meta.get("mode") is not None:
            listing_ctx.commission_mode = str(comm_meta["mode"])

    demand_mult = 1.0 + body.demand_shift_pct
    risk_mult = 1.0 + body.risk_shift_pct
    slot_intensity = 0.42 if body.vertical == "car" else 1.0

    t0 = time.perf_counter()
    out = run_simulation(
        listing_id=body.listing_id,
        time_start=start,
        time_end=end,
        price_scenarios=body.price_scenarios,
        settings=settings,
        listing=listing_ctx,
        demand_multiplier=demand_mult,
        risk_multiplier=risk_mult,
        slot_intensity=slot_intensity,
    )
    dt = time.perf_counter() - t0
    if settings.metrics_enabled:
        metrics.SIMULATION_LATENCY.observe(dt)
        metrics.SIMULATION_RUNS.labels(cached="false", vertical=body.vertical).inc()

    out["cached"] = False
    out["vertical"] = body.vertical
    if comm_meta:
        out["upstream"] = {"commission_engine": comm_meta}
    _cache_set_for_body(body, out)
    return out


_rl = _settings_init.rate_limit_per_minute
if _rl > 0:
    simulation_run = limiter.limit(f"{_rl}/minute")(simulation_run)

app.add_api_route(
    "/v1/simulation/run",
    simulation_run,
    methods=["POST"],
    name="simulation_run",
)


@app.get("/")
def root():
    index = _PUBLIC / "index.html"
    if index.is_file():
        return FileResponse(index)
    return {"service": "simulation-intelligence", "docs": "/docs", "health": "/health"}
