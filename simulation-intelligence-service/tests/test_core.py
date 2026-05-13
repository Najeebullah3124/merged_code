from datetime import datetime, timedelta, timezone

from app.config import get_settings
from app.engine.core import run_simulation


def test_run_simulation_shape():
    settings = get_settings()
    start = datetime(2026, 5, 2, 10, 0, tzinfo=timezone.utc)
    end = start + timedelta(days=2)
    out = run_simulation(
        listing_id="demo-listing-1",
        time_start=start,
        time_end=end,
        price_scenarios=[90, 110, 130],
        settings=settings,
        listing=None,
    )
    assert "timeline" in out and len(out["timeline"]) >= 1
    assert "price_curve" in out and len(out["price_curve"]) == 3
    assert out["best_scenario"]["price"] in [90, 110, 130]
    assert "recommendation" in out
    assert out["meta"]["points"] == len(out["timeline"])
    row = out["timeline"][0]
    for k in (
        "demand",
        "risk",
        "availability_effective",
        "sync_factor",
        "price",
        "revenue",
        "revenue_host_net",
        "risk_zone",
        "booking_locked",
        "decision",
    ):
        assert k in row
    assert "feedback_loop" in out
    assert out["feedback_loop"]["status"] == "ok"
    assert "layers" in out
    assert "commission_summary" in out
