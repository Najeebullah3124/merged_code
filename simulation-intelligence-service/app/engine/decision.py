from __future__ import annotations

from enum import Enum


# Doc thresholds: >0.8 hard lock, <0.5 allow
RISK_HARD_LOCK = 0.8
RISK_ALLOW = 0.5
RISK_UNSTABLE_BAND = 0.65


class OrchestratorAction(str, Enum):
    PROMOTE = "PROMOTE"
    HOLD = "HOLD"
    DEFEND = "DEFEND"
    REDUCE_PRICE = "REDUCE_PRICE"
    BLOCK = "BLOCK"


class RiskZone(str, Enum):
    LOCK = "LOCK"  # red — hard lock
    UNSTABLE = "UNSTABLE"  # yellow
    SAFE = "SAFE"  # green


def risk_zone(risk: float) -> str:
    if risk >= RISK_HARD_LOCK:
        return RiskZone.LOCK.value
    if risk >= RISK_UNSTABLE_BAND:
        return RiskZone.UNSTABLE.value
    if risk < RISK_ALLOW:
        return RiskZone.SAFE.value
    return RiskZone.UNSTABLE.value


def decide(
    *,
    risk: float,
    demand: float,
    revenue_net: float,
    revenue_baseline: float,
    defend_threshold: float = 0.65,
    catastrophic_threshold: float = 0.95,
) -> str:
    if risk >= catastrophic_threshold:
        return OrchestratorAction.BLOCK.value
    if risk >= RISK_HARD_LOCK:
        return OrchestratorAction.BLOCK.value
    if risk >= defend_threshold:
        return OrchestratorAction.DEFEND.value
    if demand >= 0.72 and risk < RISK_ALLOW and revenue_net >= revenue_baseline * 1.02:
        return OrchestratorAction.PROMOTE.value
    if demand < 0.38 or revenue_net < revenue_baseline * 0.92:
        return OrchestratorAction.REDUCE_PRICE.value
    return OrchestratorAction.HOLD.value
