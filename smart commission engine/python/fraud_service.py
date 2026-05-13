from typing import Dict

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Smart Commission Fraud Service")


class History(BaseModel):
    bookings_last_24h: int = 0
    bookings: int = 0
    cancellations: int = 0
    price_std: float = 0.0
    repeat_user_host_count: int = 0
    ip_overlap_score: float = 0.0


class FraudRequest(BaseModel):
    event_type: str
    user_id: str
    host_id: str
    listing_id: str
    history: History


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def risk_score_from_history(history: History) -> float:
    cancellation_rate = history.cancellations / max(history.bookings, 1)
    booking_frequency_score = clamp(history.bookings_last_24h / 20)
    cancellation_score = clamp(cancellation_rate)
    price_manipulation_score = clamp(history.price_std / 50)
    repeat_pair_score = clamp(history.repeat_user_host_count / 10)
    ip_overlap_score = clamp(history.ip_overlap_score)

    score = (
        0.25 * booking_frequency_score
        + 0.2 * cancellation_score
        + 0.25 * price_manipulation_score
        + 0.15 * repeat_pair_score
        + 0.15 * ip_overlap_score
    )
    return round(clamp(score), 4)


def classify(score: float) -> str:
    if score >= 0.85:
        return "critical"
    if score >= 0.7:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"


@app.post("/fraud-score")
def fraud_score(request: FraudRequest) -> Dict[str, object]:
    score = risk_score_from_history(request.history)
    level = classify(score)
    return {
        "fraud_score": score,
        "risk_level": level,
        "exclude_from_training": level in {"high", "critical"},
        "limit_markup_influence": level in {"high", "critical"},
    }
