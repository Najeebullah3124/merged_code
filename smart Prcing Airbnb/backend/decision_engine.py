from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

try:
    from .pricing_engine import ListingSignals, clamp, expected_revenue
except ImportError:
    from pricing_engine import ListingSignals, clamp, expected_revenue


@dataclass
class DecisionResult:
    action: str  # NORMAL | BLOCK
    price: Optional[float]
    conversion: Optional[float]
    expected_revenue: Optional[float]
    model_used: str


def build_features(
    *,
    listing: ListingSignals,
    price: float,
) -> Dict[str, float]:
    rt = (listing.room_type or "").lower()
    return {
        "price": float(price),
        "review_rate": float(listing.review_rate or 0.0),
        "reviews_count": float(listing.reviews_count or 0.0),
        "availability_365": float(listing.availability_365 or 0.0),
        "instant_bookable": 1.0 if bool(listing.instant_bookable) else 0.0,
        "room_type_private": 1.0 if "private" in rt else 0.0,
        "room_type_shared": 1.0 if "shared" in rt else 0.0,
        "room_type_entire": 1.0 if "entire" in rt else 0.0,
    }


def optimize_price_grid(
    *,
    listing: ListingSignals,
    min_price: float,
    max_price: float,
    step: float,
    conversion_model: Any,
) -> DecisionResult:
    best_price: Optional[float] = None
    best_rev: float = -1.0
    best_p: Optional[float] = None

    p = float(min_price)
    while p <= float(max_price) + 1e-9:
        feats = build_features(listing=listing, price=p)
        prob = float(conversion_model.predict_proba(feats))
        rev = expected_revenue(p, prob)
        if rev > best_rev:
            best_rev = rev
            best_price = p
            best_p = prob
        p += float(step)

    return DecisionResult(
        action="NORMAL",
        price=best_price,
        conversion=best_p,
        expected_revenue=best_rev if best_price is not None else None,
        model_used="conversion_model",
    )


def decide_simulation(
    *,
    listing: ListingSignals,
    min_price: float,
    max_price: float,
    conversion_model: Optional[Any],
) -> Optional[DecisionResult]:
    if conversion_model is None:
        return None
    return optimize_price_grid(
        listing=listing,
        min_price=min_price,
        max_price=max_price,
        step=max(5.0, round((max_price - min_price) / 30.0, 2)),
        conversion_model=conversion_model,
    )

