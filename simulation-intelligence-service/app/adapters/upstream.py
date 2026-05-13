from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import Settings
from app.engine.core import ListingContext

log = logging.getLogger(__name__)


async def fetch_lodging_listing_context(
    client: httpx.AsyncClient,
    settings: Settings,
    listing_id: str,
) -> ListingContext | None:
    base = settings.upstream_lodging_base_url
    if not base:
        return None
    url = base.rstrip("/") + f"/api/pricing/{listing_id}"
    try:
        r = await client.get(url, timeout=settings.request_timeout_seconds)
    except httpx.RequestError as e:
        log.debug("lodging upstream unreachable: %s", e)
        return None
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        log.debug("lodging upstream error %s: %s", r.status_code, r.text[:200])
        return None
    data: dict[str, Any] = r.json()
    listing = data.get("listing") or {}
    prefs = data.get("settings") or {}
    name = listing.get("name")
    min_p = float(prefs.get("min_price") or 0)
    max_p = float(prefs.get("max_price") or 0)
    base_price = prefs.get("base_price") or data.get("suggested_try_price")
    if base_price is None:
        base_price = (min_p + max_p) / 2 if min_p and max_p else None
    if base_price is None:
        return None
    bp = float(base_price)
    if min_p <= 0:
        min_p = max(20.0, round(bp * 0.6, 2))
    if max_p <= 0:
        max_p = round(bp * 1.5, 2)
    suggested_try = data.get("suggested_try_price")
    if suggested_try is not None:
        sp = float(suggested_try)
    else:
        sp = round((min_p + max_p) / 2, 2)
    return ListingContext(
        base_anchor=bp,
        min_price=min_p,
        max_price=max_p,
        name=str(name)[:120] if name else None,
        current_price=bp,
        suggested_price=round(sp, 2),
    )


async def fetch_commission_pricing_hint(
    client: httpx.AsyncClient,
    settings: Settings,
    listing_id: str,
) -> dict[str, Any] | None:
    base = settings.upstream_commission_base_url
    if not base:
        return None
    url = base.rstrip("/") + f"/pricing/{listing_id}"
    try:
        r = await client.get(url, timeout=settings.request_timeout_seconds)
    except httpx.RequestError as e:
        log.debug("commission upstream unreachable: %s", e)
        return None
    if r.status_code != 200:
        return None
    data: dict[str, Any] = r.json()
    return {
        "markup": data.get("markup"),
        "mode": data.get("mode"),
        "final_price": data.get("final_price"),
    }


async def fetch_parallel_listing_context(
    client: httpx.AsyncClient,
    settings: Settings,
    listing_id: str,
    *,
    include_commission: bool,
) -> tuple[ListingContext | None, dict[str, Any] | None]:
    """
    Doc: parallel execution of model/adapters (Promise.all style).
    """
    lodger = fetch_lodging_listing_context(client, settings, listing_id)
    if include_commission and settings.upstream_commission_base_url:
        commer = fetch_commission_pricing_hint(client, settings, listing_id)
        a, b = await asyncio.gather(lodger, commer, return_exceptions=True)
    else:
        a = await lodger
        b = None

    if isinstance(a, Exception):
        log.debug("lodging task failed: %s", a)
        a = None
    if isinstance(b, Exception):
        log.debug("commission task failed: %s", b)
        b = None

    ctx = a if a is None or isinstance(a, ListingContext) else None
    ch = b if b is None or isinstance(b, dict) else None

    if ctx and ch and ch.get("markup") is not None:
        try:
            ctx.commission_markup = float(ch["markup"])
        except (TypeError, ValueError):
            pass
        if ch.get("mode") is not None:
            ctx.commission_mode = str(ch["mode"])

    return ctx, ch
