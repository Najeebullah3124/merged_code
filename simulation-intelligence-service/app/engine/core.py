from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.config import Settings
from app.engine.decision import RISK_HARD_LOCK, decide, risk_zone
from app.engine.signals import (
    availability_at,
    conversion_probability,
    couple_risk_to_availability,
    demand_score_at,
    iter_time_steps,
    listing_seed,
    risk_score_at,
    sync_step_factor,
)


@dataclass
class ListingContext:
    base_anchor: float
    min_price: float
    max_price: float
    name: str | None = None
    current_price: float | None = None
    suggested_price: float | None = None
    commission_markup: float | None = None
    commission_mode: str | None = None


def default_listing_context(listing_id: str) -> ListingContext:
    s = listing_seed(listing_id)
    base = 80.0 + (s % 70)
    return ListingContext(
        base_anchor=float(base),
        min_price=max(25.0, round(base * 0.55, 2)),
        max_price=round(base * 1.55, 2),
        current_price=float(base),
        suggested_price=round(base * 1.03, 2),
        name=None,
    )


def _effective_commission_rate(settings: Settings, listing: ListingContext | None) -> float:
    base = float(settings.platform_commission_pct)
    if listing and listing.commission_markup is not None:
        # markup from commission engine nudges platform take within guardrails
        return max(0.0, min(0.5, base + float(listing.commission_markup) * 0.15))
    return base


def _build_feedback_loop(
    timeline: list[dict[str, Any]],
    listing_id: str,
) -> dict[str, Any]:
    """Doc: prediction → actual proxy → error → retrain signal."""
    if not timeline:
        return {
            "status": "insufficient_data",
            "pipeline_hook": "prediction_feedback",
        }
    seed = listing_seed(listing_id)
    pred = sum(r["demand"] for r in timeline) / len(timeline)
    drift = 0.92 + 0.08 * math.sin(seed % 17)
    actual_proxy = _clamp01(pred * drift)
    err = pred - actual_proxy
    return {
        "status": "ok",
        "pipeline_hook": "prediction_feedback",
        "prediction_demand_mean": round(pred, 4),
        "outcome_demand_proxy": round(actual_proxy, 4),
        "error": round(err, 4),
        "model_update_recommended": abs(err) > 0.04,
        "ml_retraining_hooks": ["ranking", "conversion", "risk_calibration"],
    }


def _layer_notes() -> dict[str, str]:
    return {
        "demand_curve": "Baseline demand score from demand_forecast() / composite signal",
        "availability_filter": "availability_probability × sync_interval × risk coupling (doc loop)",
        "risk_overlay": "risk_score with LOCK/UNSTABLE/SAFE zones; >=0.8 hard lock",
        "price_line": "Chosen scenario price or optimized pick per timestep",
        "revenue_curve": "Gross and host net after commission overlay",
        "commission_overlay": "Platform take vs host net; optional commission engine markup",
        "final_decision": "Orchestrator output (EV + safety)",
    }


def run_simulation(
    *,
    listing_id: str,
    time_start: datetime,
    time_end: datetime,
    price_scenarios: list[float],
    settings: Settings,
    listing: ListingContext | None = None,
    demand_multiplier: float = 1.0,
    risk_multiplier: float = 1.0,
    slot_intensity: float = 1.0,
) -> dict[str, Any]:
    ctx = listing or default_listing_context(listing_id)
    if ctx.current_price is None:
        ctx.current_price = ctx.base_anchor
    if ctx.suggested_price is None:
        ctx.suggested_price = round(ctx.base_anchor * 1.04, 2)

    seed = listing_seed(listing_id)
    prices = sorted({round(float(p), 2) for p in price_scenarios if p > 0})
    if not prices:
        prices = [round(ctx.base_anchor, 2)]

    comm = _effective_commission_rate(settings, ctx)
    units = float(settings.booking_units_per_slot) * max(0.0, slot_intensity)
    times = list(iter_time_steps(time_start, time_end))
    sync_h = int(settings.sync_interval_hours)

    timeline: list[dict[str, Any]] = []
    baseline_revenue = max(1.0, ctx.base_anchor * 0.18 * units)

    for t in times:
        d = _clamp01(demand_score_at(seed, t) * demand_multiplier)
        r = _clamp01(risk_score_at(seed, t) * risk_multiplier)
        a_raw = availability_at(seed, t)
        sync_f = sync_step_factor(seed, t, sync_h)
        a_pre = _clamp01(a_raw * sync_f)
        a_eff = couple_risk_to_availability(a_pre, r)
        rz = risk_zone(r)
        locked = r >= RISK_HARD_LOCK

        best: dict[str, Any] | None = None
        for price in prices:
            price = max(ctx.min_price, min(ctx.max_price, price))
            conv = conversion_probability(price, ctx.base_anchor, d, r)
            bookings = d * conv * a_eff * units
            if locked:
                bookings *= 0.04
            gross = bookings * price
            net_host = gross * (1.0 - comm)
            platform_take = gross * comm
            decision = decide(
                risk=r,
                demand=d,
                revenue_net=net_host,
                revenue_baseline=baseline_revenue * (0.85 + 0.3 * d),
            )
            cand = {
                "price": price,
                "conversion": round(conv, 4),
                "expected_bookings": round(bookings, 4),
                "revenue_gross": round(gross, 2),
                "revenue": round(net_host, 2),
                "revenue_host_net": round(net_host, 2),
                "platform_take": round(gross * comm, 2),
                "decision": decision,
            }
            if best is None or cand["revenue"] > best["revenue"]:
                best = cand

        assert best is not None
        b = float(best["expected_bookings"])
        g = float(best["revenue_gross"])
        nh = float(best["revenue_host_net"])
        pt = float(best.get("platform_take") or round(g * comm, 2))

        timeline.append(
            {
                "time": t.isoformat().replace("+00:00", "Z"),
                "demand": round(d, 4),
                "risk": round(r, 4),
                "availability_raw": round(a_raw, 4),
                "sync_factor": round(sync_f, 4),
                "availability": round(a_pre, 4),
                "availability_effective": round(a_eff, 4),
                "price": best["price"],
                "conversion": best["conversion"],
                "expected_bookings": b,
                "bookings": round(b, 2),
                "revenue_gross": g,
                "revenue": nh,
                "revenue_host_net": nh,
                "platform_take": pt,
                "host_earnings": nh,
                "commission_rate_applied": comm,
                "risk_zone": rz,
                "booking_locked": locked,
                "decision": best["decision"],
            }
        )

    price_curve: list[dict[str, Any]] = []
    for price in prices:
        price = max(ctx.min_price, min(ctx.max_price, price))
        total_gross = 0.0
        total_net = 0.0
        conv_acc = 0.0
        n_s = 0
        for t in times:
            d = _clamp01(demand_score_at(seed, t) * demand_multiplier)
            r = _clamp01(risk_score_at(seed, t) * risk_multiplier)
            a_raw = availability_at(seed, t)
            sync_f = sync_step_factor(seed, t, sync_h)
            a_pre = _clamp01(a_raw * sync_f)
            a_eff = couple_risk_to_availability(a_pre, r)
            conv = conversion_probability(price, ctx.base_anchor, d, r)
            conv_acc += conv
            n_s += 1
            locked = r >= RISK_HARD_LOCK
            bookings = d * conv * a_eff * units
            if locked:
                bookings *= 0.04
            g = bookings * price
            total_gross += g
            total_net += g * (1.0 - comm)
        price_curve.append(
            {
                "price": price,
                "revenue": round(total_net, 2),
                "revenue_gross": round(total_gross, 2),
                "conversion_mean": round(conv_acc / max(1, n_s), 4),
            }
        )

    price_curve.sort(key=lambda x: x["price"])
    best_pc = max(price_curve, key=lambda x: x["revenue"])

    high_risk_periods = _risk_windows(timeline)
    recommendation = _build_recommendation(timeline, best_pc, ctx)
    feedback_loop = _build_feedback_loop(timeline, listing_id)

    optimal_price = best_pc["price"]
    rz_counts = {
        "LOCK": sum(1 for row in timeline if row["risk_zone"] == "LOCK"),
        "UNSTABLE": sum(1 for row in timeline if row["risk_zone"] == "UNSTABLE"),
        "SAFE": sum(1 for row in timeline if row["risk_zone"] == "SAFE"),
    }
    model_suggested = round(float(recommendation["best_price"]), 2)

    return {
        "listing_id": listing_id,
        "listing": {
            "base_anchor": ctx.base_anchor,
            "min_price": ctx.min_price,
            "max_price": ctx.max_price,
            "name": ctx.name,
            "current_price": ctx.current_price,
            "suggested_price": ctx.suggested_price,
        },
        "timeline": timeline,
        "price_curve": price_curve,
        "price_curve_meta": {
            "optimal_price": optimal_price,
            "current_price": ctx.current_price,
            "host_suggested_price": ctx.suggested_price,
            "model_suggested_price": model_suggested,
        },
        "best_scenario": {
            "price": best_pc["price"],
            "revenue": best_pc["revenue"],
            "revenue_gross": best_pc.get("revenue_gross"),
        },
        "recommendation": recommendation,
        "risk_summary": {
            "high_risk_periods": high_risk_periods,
            "max_risk": max((row["risk"] for row in timeline), default=0.0),
            "thresholds": {"hard_lock": RISK_HARD_LOCK, "allow": 0.5, "unstable_band": 0.65},
            "zones": rz_counts,
        },
        "feedback_loop": feedback_loop,
        "layers": _layer_notes(),
        "commission_summary": {
            "platform_commission_pct": comm,
            "source": "commission_engine" if ctx.commission_markup is not None else "config",
            "markup_hint": ctx.commission_markup,
            "mode": ctx.commission_mode,
        },
        "meta": {
            "platform_commission_pct": comm,
            "booking_units_per_slot": units,
            "sync_interval_hours": sync_h,
            "points": len(timeline),
            "model_interaction": "demand→pricing; demand→risk; risk→availability; pricing→conversion; revenue→orchestrator",
        },
    }


def _build_recommendation(
    timeline: list[dict[str, Any]],
    best_pc: dict[str, Any],
    ctx: ListingContext,
) -> dict[str, Any]:
    if not timeline:
        return {
            "action": "HOLD",
            "reason": "No timeline data",
            "confidence": 0.0,
            "best_price": ctx.base_anchor,
            "expected_window_revenue": 0.0,
        }
    avg_dem = sum(r["demand"] for r in timeline) / len(timeline)
    avg_risk = sum(r["risk"] for r in timeline) / len(timeline)
    total_rev = sum(r["revenue_host_net"] for r in timeline)

    if avg_risk > 0.75:
        action = "DEFEND"
        reason = "Elevated risk across the window — tighten booking rules and monitor fraud signals."
        conf = 0.78
    elif avg_dem > 0.65 and avg_risk < 0.45:
        action = "INCREASE_PRICE"
        reason = "Strong demand with manageable risk — move toward the optimal price on the revenue curve."
        conf = 0.84
    elif avg_dem < 0.42:
        action = "DECREASE_PRICE_OR_PROMOTE"
        reason = "Soft demand — test a lower price or increase listing quality signals."
        conf = 0.72
    else:
        action = "HOLD"
        reason = "Balanced market — keep strategy; use overlays to time price moves."
        conf = 0.66

    return {
        "action": action,
        "reason": reason,
        "confidence": round(conf, 2),
        "best_price": best_pc["price"],
        "expected_window_revenue": round(total_rev, 2),
    }


def _risk_windows(timeline: list[dict[str, Any]], threshold: float = 0.72) -> list[str]:
    if not timeline:
        return []
    windows: list[str] = []
    i = 0
    while i < len(timeline):
        if timeline[i]["risk"] < threshold:
            i += 1
            continue
        start = timeline[i]["time"]
        j = i
        while j < len(timeline) and timeline[j]["risk"] >= threshold:
            j += 1
        end = timeline[j - 1]["time"]
        windows.append(f"{_short_ts(start)}–{_short_ts(end)}")
        i = j
    return windows[:12]


def _short_ts(iso: str) -> str:
    return iso[:16].replace("T", " ") if len(iso) >= 16 else iso


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))
