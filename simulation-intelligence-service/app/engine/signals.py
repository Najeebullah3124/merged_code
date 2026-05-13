from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Iterator


def listing_seed(listing_id: str) -> int:
    h = 0
    for c in listing_id:
        h = (h * 31 + ord(c)) & 0xFFFFFFFF
    return h if h else 1


def iter_time_steps(
    start: datetime,
    end: datetime,
    *,
    max_points: int = 500,
) -> Iterator[datetime]:
    t = start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start.astimezone(timezone.utc)
    end_utc = end.replace(tzinfo=timezone.utc) if end.tzinfo is None else end.astimezone(timezone.utc)
    if end_utc <= t:
        yield t
        return
    span = end_utc - t
    if span <= timedelta(days=7):
        step = timedelta(hours=1)
    elif span <= timedelta(days=45):
        step = timedelta(hours=6)
    else:
        step = timedelta(days=1)

    n = 0
    while t <= end_utc and n < max_points:
        yield t
        t += step
        n += 1


def demand_score_at(seed: int, t: datetime) -> float:
    """0..1 demand intensity (deterministic for a given listing + time)."""
    u = (seed % 97) / 97.0
    day = t.timetuple().tm_yday
    hour = t.hour
    # weekly + diurnal pattern
    w = 0.55 + 0.25 * math.sin((day + u * 10) / 4.0)
    d = 0.12 * math.sin((hour - 6) / 12.0 * math.pi)  # afternoon lift
    base = w + d
    return _clamp01(base)


def risk_score_at(seed: int, t: datetime) -> float:
    """0..1 risk; higher in late evening (fraud / last-minute)."""
    u = ((seed * 7) % 53) / 53.0
    hour = t.hour
    weekend = 1.0 if t.weekday() >= 5 else 0.0
    late = 1.0 if hour >= 22 or hour < 5 else 0.0
    r = 0.15 + 0.08 * weekend + 0.18 * late + 0.12 * math.sin((hour + u * 5) / 6.0)
    return _clamp01(r)


def availability_at(seed: int, t: datetime) -> float:
    """0..1 bookable inventory signal."""
    u = ((seed * 13) % 41) / 41.0
    weekend_drop = 0.08 if t.weekday() >= 5 else 0.0
    a = 0.88 - weekend_drop + 0.05 * math.sin((t.timetuple().tm_yday + u * 3) / 7.0)
    return _clamp01(a)


def sync_step_factor(seed: int, t: datetime, interval_hours: int) -> float:
    """
    Sync interval model (doc): step function over time — data freshness & conflict risk.
    Alternates between two plateaus to mimic refresh cycles.
    """
    ih = max(1, int(interval_hours))
    t_utc = t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)
    hour_block = int(t_utc.timestamp() // 3600)
    step = (hour_block // ih) % 2
    u = (seed % 7) / 7.0
    base = 0.86 + 0.12 * step
    return _clamp01(base + 0.02 * math.sin(u + float(step)))


def couple_risk_to_availability(availability: float, risk: float) -> float:
    """
    Doc interaction: risk affects availability (unsafe windows reduce bookable flow).
    """
    penalty = 0.15 + 0.55 * max(0.0, risk - 0.35) ** 1.25
    return _clamp01(availability * (1.0 - penalty))


def conversion_probability(
    price: float,
    base_anchor: float,
    demand: float,
    risk: float,
) -> float:
    """
    Elasticity-style conversion: price above anchor hurts; demand helps; risk hurts.
    """
    base = max(base_anchor, 1.0)
    rel = (price - base) / base
    penalty = max(0.0, rel) * 0.85
    discount_boost = max(0.0, -rel) * 0.35
    c = 0.22 + 0.45 * demand - 0.4 * penalty + discount_boost - 0.25 * risk
    return _clamp01(c)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))
