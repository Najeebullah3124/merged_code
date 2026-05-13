from __future__ import annotations

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

SIMULATION_RUNS = Counter(
    "sis_simulation_runs_total",
    "Simulation runs",
    ["cached", "vertical"],
)
SIMULATION_LATENCY = Histogram(
    "sis_simulation_run_seconds",
    "Wall time for /v1/simulation/run",
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
)
CACHE_HITS = Counter("sis_cache_hits_total", "Cache hits", ["backend"])
CACHE_MISSES = Counter("sis_cache_misses_total", "Cache misses", ["backend"])


def metrics_body() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
