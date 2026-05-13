from fastapi.testclient import TestClient

from app.main import app


def test_health():
    c = TestClient(app)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_simulation_run():
    c = TestClient(app)
    body = {
        "listing_id": "x-123",
        "time_range": ["2026-05-02T10:00:00Z", "2026-05-04T10:00:00Z"],
        "price_scenarios": [80, 100, 120],
        "vertical": "lodging",
        "use_upstream_listing": False,
    }
    r = c.post("/v1/simulation/run", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["cached"] is False
    assert len(data["timeline"]) >= 1
    assert "feedback_loop" in data
    assert "price_curve_meta" in data
    r = c.get("/ready")
    assert r.status_code == 200
