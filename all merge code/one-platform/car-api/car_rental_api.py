"""
HTTP API for car-rental smart pricing (FastAPI).

Run from this folder:
  uvicorn car_rental_api:app --reload --host 127.0.0.1 --port 8000

Train models first:  python car.py
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import math
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import Counter
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel, Field, field_validator, model_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from admin_controls import AdminControlsStore
from car_rental_service import CarRentalPricingService, DEFAULT_MODEL_DIR
from inference_service import InferenceService
from probability_model import BookingProbabilityModel
from quote_cache import cache_get, cache_set

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Car rental smart pricing", version="1.2.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Allow requests from the Next.js dev server.
# Override in production with `CORS_ALLOW_ORIGINS` (comma-separated).
cors_origins_env = os.environ.get("CORS_ALLOW_ORIGINS", "").strip()
if cors_origins_env:
    cors_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
    allow_credentials = os.environ.get("CORS_ALLOW_CREDENTIALS", "true").lower() in ("1", "true", "yes")
else:
    # If env not provided, allow all origins for dev convenience.
    # NOTE: Wildcard origins require allow_credentials=false.
    cors_origins = ["*"]
    allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=True)

FALLBACK_COUNTER = Counter("pricing_fallback_total", "Total fallback quote responses")
GUARDRAIL_HITS_COUNTER = Counter("pricing_guardrail_hits_total", "Total guardrail rule hits")
KILL_SWITCH_COUNTER = Counter("pricing_kill_switch_total", "Total quotes served while kill switch is active")
OPTIMIZATION_CANDIDATES_COUNTER = Counter(
    "pricing_optimization_candidates_total", "Total optimization candidates evaluated"
)

_service: CarRentalPricingService | None = None
_prob_model: BookingProbabilityModel | None = None
_inference_service: InferenceService | None = None
_admin_store: AdminControlsStore | None = None


MAX_REQUEST_BYTES = int(os.environ.get("MAX_REQUEST_BYTES", "65536"))
DATASET_PATH = Path(__file__).resolve().parent / "car rental sample_augmented_demo.csv"
OVERRIDES_PATH = Path(__file__).resolve().parent / "runtime" / "price_overrides.json"
LISTING_SETTINGS_PATH = Path(__file__).resolve().parent / "runtime" / "listing_settings.json"
OVERRIDE_AUDIT_PATH = Path(__file__).resolve().parent / "runtime" / "override_audit.jsonl"
APPROVALS_PATH = Path(__file__).resolve().parent / "runtime" / "listing_approvals.json"

_listings_cache: list[dict] | None = None
_listing_by_id: dict[str, dict] | None = None
ALLOWED_APPROVAL_STATUSES = {"pending", "approved", "rejected"}
ALLOWED_LISTING_SORT_FIELDS = {
    "title": "title",
    "city": "city",
    "country": "country",
    "group": "group",
    "supplierName": "supplier_name",
    "avgPrice": "avgPrice",
    "revenue": "revenue",
    "occupancyRate": "occupancyRate",
    "approvalStatus": "approvalStatus",
}


def get_service() -> CarRentalPricingService:
    global _service
    if _service is None:
        try:
            _service = CarRentalPricingService(DEFAULT_MODEL_DIR)
        except FileNotFoundError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
    return _service


def get_prob_model() -> BookingProbabilityModel:
    global _prob_model
    if _prob_model is None:
        _prob_model = BookingProbabilityModel()
    return _prob_model


def get_admin_store() -> AdminControlsStore:
    global _admin_store
    if _admin_store is None:
        _admin_store = AdminControlsStore()
    return _admin_store


def get_inference_service() -> InferenceService:
    global _inference_service
    if _inference_service is None:
        _inference_service = InferenceService(
            prob_model=get_prob_model(),
            admin_store=get_admin_store(),
        )
    return _inference_service


def _load_overrides() -> dict[str, dict[str, float]]:
    if not OVERRIDES_PATH.is_file():
        return {}
    try:
        data = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {
                str(k): {str(d): float(v) for d, v in vals.items()}
                for k, vals in data.items()
                if isinstance(vals, dict)
            }
    except Exception:
        pass
    return {}


def _save_overrides(data: dict[str, dict[str, float]]) -> None:
    OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
    OVERRIDES_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _load_listing_settings() -> dict[str, dict]:
    if not LISTING_SETTINGS_PATH.is_file():
        return {}
    try:
        raw = json.loads(LISTING_SETTINGS_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return {str(k): v for k, v in raw.items() if isinstance(v, dict)}
    except Exception:
        pass
    return {}


def _save_listing_settings(data: dict[str, dict]) -> None:
    LISTING_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    LISTING_SETTINGS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_listing_approvals() -> dict[str, dict]:
    if not APPROVALS_PATH.is_file():
        return {}
    try:
        raw = json.loads(APPROVALS_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return {str(k): v for k, v in raw.items() if isinstance(v, dict)}
    except Exception:
        pass
    return {}


def _save_listing_approvals(data: dict[str, dict]) -> None:
    APPROVALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    APPROVALS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _approval_for(listing_id: str) -> dict[str, str | None]:
    approval = _load_listing_approvals().get(listing_id, {})
    status = str(approval.get("approvalStatus") or "pending").strip().lower()
    if status not in ALLOWED_APPROVAL_STATUSES:
        status = "pending"
    return {
        "approvalStatus": status,
        "approvalReason": str(approval.get("approvalReason")) if approval.get("approvalReason") is not None else None,
        "reviewedBy": str(approval.get("reviewedBy")) if approval.get("reviewedBy") is not None else None,
        "reviewedAt": str(approval.get("reviewedAt")) if approval.get("reviewedAt") is not None else None,
    }


def _decorate_listing(item: dict) -> dict:
    return {**item, **_approval_for(str(item.get("id", "")))}


def _filtered_listings(
    *,
    search: str | None = None,
    city: str | None = None,
    country: str | None = None,
    group: str | None = None,
    supplier_name: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    approval_status: str | None = None,
    sort_by: str = "title",
    sort_order: str = "asc",
) -> list[dict]:
    rows, _ = _ensure_listings_cache()
    items = [_decorate_listing(row) for row in rows]

    search_needle = (search or "").strip().lower()
    city_needle = (city or "").strip().lower()
    country_needle = (country or "").strip().lower()
    group_needle = (group or "").strip().lower()
    supplier_needle = (supplier_name or "").strip().lower()
    approval_needle = (approval_status or "").strip().lower()

    out: list[dict] = []
    for item in items:
        haystack = " ".join(
            [
                str(item.get("title", "")),
                str(item.get("location", "")),
                str(item.get("city", "")),
                str(item.get("country", "")),
                str(item.get("group", "")),
                str(item.get("supplier_name", "")),
            ]
        ).lower()
        if search_needle and search_needle not in haystack:
            continue
        if city_needle and str(item.get("city", "")).strip().lower() != city_needle:
            continue
        if country_needle and str(item.get("country", "")).strip().lower() != country_needle:
            continue
        if group_needle and str(item.get("group", "")).strip().lower() != group_needle:
            continue
        if supplier_needle and supplier_needle not in str(item.get("supplier_name", "")).strip().lower():
            continue
        avg_price = float(item.get("avgPrice", 0) or 0)
        if min_price is not None and avg_price < min_price:
            continue
        if max_price is not None and avg_price > max_price:
            continue
        if approval_needle:
            normalized_status = approval_needle if approval_needle in ALLOWED_APPROVAL_STATUSES else "pending"
            if str(item.get("approvalStatus", "pending")).lower() != normalized_status:
                continue
        out.append(item)

    key_name = ALLOWED_LISTING_SORT_FIELDS.get(sort_by, "title")
    reverse = str(sort_order).lower() == "desc"
    out.sort(key=lambda x: (x.get(key_name) is None, str(x.get(key_name, "")).lower() if isinstance(x.get(key_name), str) else x.get(key_name, 0)), reverse=reverse)
    return out


def _paginate(items: list[dict], *, page: int, page_size: int) -> dict:
    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, 100))
    total = len(items)
    total_pages = max(1, math.ceil(total / safe_page_size)) if total else 1
    start_idx = (safe_page - 1) * safe_page_size
    end_idx = start_idx + safe_page_size
    return {
        "items": items[start_idx:end_idx],
        "pagination": {
            "page": safe_page,
            "pageSize": safe_page_size,
            "total": total,
            "totalPages": total_pages,
            "hasNext": safe_page < total_pages,
            "hasPrevious": safe_page > 1,
        },
    }


def _to_csv_response(filename: str, rows: list[dict], fieldnames: list[str]) -> Response:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k) for k in fieldnames})
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _dashboard_payload(listings: list[dict]) -> dict:
    revenue = sum(float(x.get("revenue", 0) or 0) for x in listings)
    avg_occ = (sum(float(x.get("occupancyRate", 0) or 0) for x in listings) / len(listings)) if listings else 0.0
    avg_price = (sum(float(x.get("avgPrice", 0) or 0) for x in listings) / len(listings)) if listings else 0.0
    active_bookings_proxy = round(sum(float(x.get("occupancyRate", 0) or 0) for x in listings) * 10)
    approved = sum(1 for x in listings if x.get("approvalStatus") == "approved")
    pending = sum(1 for x in listings if x.get("approvalStatus") == "pending")
    rejected = sum(1 for x in listings if x.get("approvalStatus") == "rejected")
    return {
        "summary": {
            "projectedRevenue": round(revenue, 2),
            "estimatedOccupancy": round(avg_occ, 4),
            "averageDailyRate": round(avg_price, 2),
            "activeBookingsProxy": active_bookings_proxy,
            "approvedCount": approved,
            "pendingCount": pending,
            "rejectedCount": rejected,
        },
        "items": listings,
    }


def _default_settings_for(item: dict) -> dict:
    avg_price = float(item.get("avgPrice", 80.0) or 80.0)
    min_p = max(5.0, round(avg_price * 0.6, 2))
    max_p = round(max(avg_price * 1.8, avg_price + 20), 2)
    return {
        "minPrice": min_p,
        "maxPrice": max_p,
        "smartPricingEnabled": True,
        "discounts": {"weekly": 10, "monthly": 20},
    }


def _current_settings_for(listing_id: str, item: dict) -> dict:
    settings = _load_listing_settings()
    base = _default_settings_for(item)
    saved = settings.get(listing_id, {})
    out = {
        "minPrice": float(saved.get("minPrice", base["minPrice"])),
        "maxPrice": float(saved.get("maxPrice", base["maxPrice"])),
        "smartPricingEnabled": bool(saved.get("smartPricingEnabled", base["smartPricingEnabled"])),
        "discounts": {
            "weekly": float(saved.get("discounts", {}).get("weekly", base["discounts"]["weekly"])),
            "monthly": float(saved.get("discounts", {}).get("monthly", base["discounts"]["monthly"])),
        },
    }
    if out["minPrice"] > out["maxPrice"]:
        out["minPrice"], out["maxPrice"] = out["maxPrice"], out["minPrice"]
    return out


def _compute_calendar_price(item: dict, listing_id: str, d: date, idx: int) -> tuple[float, dict]:
    base = float(item.get("avgPrice", 80.0) or 80.0)
    season = _seasonal_multiplier(d)
    cyc = 1.0 + 0.04 * math.sin(idx / 8.0)
    computed = max(5.0, round(base * season * cyc, 2))

    settings = _current_settings_for(listing_id, item)
    min_p = float(settings["minPrice"])
    max_p = float(settings["maxPrice"])
    bounded = min(max(computed, min_p), max_p)

    overrides = _load_overrides().get(listing_id, {})
    final_price = float(overrides.get(d.isoformat(), bounded))
    return round(final_price, 2), settings


def _write_override_audit(entry: dict) -> None:
    OVERRIDE_AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OVERRIDE_AUDIT_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")


def _read_override_audit(listing_id: str, *, limit: int = 200) -> list[dict]:
    if not OVERRIDE_AUDIT_PATH.is_file():
        return []
    lines = OVERRIDE_AUDIT_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
    out: list[dict] = []
    for line in reversed(lines):
        if len(out) >= limit:
            break
        try:
            row = json.loads(line)
            if row.get("listingId") == listing_id:
                out.append(row)
        except Exception:
            continue
    return out


def _make_listing_id(city: str, group: str, supplier: str, product: str) -> str:
    # Preserve full field fidelity and use a longer hash slice to avoid collisions.
    raw = json.dumps([city, group, supplier, product], ensure_ascii=False, separators=(",", ":"))
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"lst_{h}"


def _load_source_df() -> pd.DataFrame:
    # Optional Postgres source. If not configured/reachable, fallback to bundled CSV.
    db_host = os.environ.get("CAR_DB_HOST", "").strip()
    db_name = os.environ.get("CAR_DB_NAME", "").strip()
    db_user = os.environ.get("CAR_DB_USER", "").strip()
    db_password = os.environ.get("CAR_DB_PASSWORD", "").strip()
    db_port = int(os.environ.get("CAR_DB_PORT", "5432"))
    db_table = os.environ.get("CAR_DB_TABLE", "car_service").strip() or "car_service"

    if db_host and db_name and db_user and db_password:
        try:
            import psycopg2  # type: ignore

            safe_table = re.sub(r"[^a-zA-Z0-9_]", "", db_table)
            if not safe_table:
                safe_table = "car_service"

            conn = psycopg2.connect(
                host=db_host,
                port=db_port,
                dbname=db_name,
                user=db_user,
                password=db_password,
            )
            try:
                with conn.cursor() as cur:
                    cur.execute(f'SELECT * FROM "{safe_table}"')
                    rows = cur.fetchall()
                    cols = [d.name for d in cur.description] if cur.description else []
                return pd.DataFrame(rows, columns=cols)
            finally:
                conn.close()
        except Exception as e:
            logging.warning("Failed loading car data from Postgres; falling back to CSV: %s", e)

    if not DATASET_PATH.is_file():
        return pd.DataFrame()
    return pd.read_csv(DATASET_PATH)


def _ensure_listings_cache() -> tuple[list[dict], dict[str, dict]]:
    global _listings_cache, _listing_by_id
    if _listings_cache is not None and _listing_by_id is not None:
        return _listings_cache, _listing_by_id

    df = _load_source_df()
    if df.empty:
        _listings_cache = []
        _listing_by_id = {}
        return _listings_cache, _listing_by_id

    for c in ["city", "group", "supplier_name", "product_name"]:
        if c not in df.columns:
            df[c] = "unknown"
    if "price" not in df.columns:
        df["price"] = 0.0

    group_cols = ["city", "group", "supplier_name", "product_name"]
    rows: list[dict] = []
    by_id: dict[str, dict] = {}

    grouped = df.groupby(group_cols, dropna=False)
    for (city, group, supplier, product), g in grouped:
        city_s = str(city)
        group_s = str(group)
        supplier_s = str(supplier)
        product_s = str(product)
        listing_id = _make_listing_id(city_s, group_s, supplier_s, product_s)
        avg_price = float(pd.to_numeric(g["price"], errors="coerce").fillna(0).mean())
        row_count = int(len(g))
        ratings = float(pd.to_numeric(g.get("no_of_ratings"), errors="coerce").fillna(0).mean()) if "no_of_ratings" in g.columns else 0.0
        occupancy = max(0.2, min(0.95, ratings / (ratings + 2000.0))) if ratings > 0 else 0.45
        revenue = avg_price * max(row_count, 1) * 0.75
        item = {
            "id": listing_id,
            "title": product_s,
            "location": city_s,
            "city": city_s,
            "country": str(g["country"].dropna().iloc[0]) if "country" in g.columns and g["country"].notna().any() else "GB",
            "group": group_s,
            "supplier_name": supplier_s,
            "revenue": round(revenue, 2),
            "occupancyRate": round(float(occupancy), 4),
            "avgPrice": round(avg_price, 2),
            "currency": "GBP",
            "description": f"{product_s} by {supplier_s} in {city_s}.",
            "basePrice": round(avg_price, 2),
            "minPrice": max(5.0, round(avg_price * 0.6, 2)),
            "maxPrice": round(max(avg_price * 1.8, avg_price + 20), 2),
            "smartPricingEnabled": True,
            "discounts": {"weekly": 10, "monthly": 20},
        }
        rows.append(item)
        by_id[listing_id] = item

    _listings_cache = rows
    _listing_by_id = by_id
    return rows, by_id


def _quote_key_expected() -> str | None:
    return os.environ.get("QUOTE_API_KEY") or os.environ.get("API_KEY")


def verify_quote_api_key(
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> None:
    if os.environ.get("SWYFT_INTEGRATED_CAR", "").lower() in ("1", "true", "yes"):
        return
    expected = _quote_key_expected()
    if not expected:
        return
    if x_api_key != expected:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "unauthorized",
                "message": "Invalid or missing X-API-Key header.",
            },
        )


def verify_admin_api_key(
    x_admin_key: Annotated[str | None, Header(alias="X-Admin-Key")] = None,
) -> None:
    if os.environ.get("SWYFT_INTEGRATED_CAR", "").lower() in ("1", "true", "yes"):
        return
    expected = os.environ.get("ADMIN_API_KEY")
    if not expected:
        # Safe default: if no admin key configured, deny admin mutation routes.
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "ADMIN_API_KEY is not configured."})
    if x_admin_key != expected:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid X-Admin-Key header."})


class QuoteRequest(BaseModel):
    airport: str = Field(default="Heathrow Airport")
    airport_iata: str = "LHR"
    country: str = "GB"
    city: str = "London"
    rental_length: float = 2.0
    start_date: str = "2023-07-25"
    start_time: str = "10:00"
    return_date: str = "2023-07-27"
    return_time: str = "10:00"
    date_offset: float = 0.0
    mileage: str = "50 miles per rental"
    group: str = "Economy"
    transmission: str = "Manual"
    fuel_type: str = ""
    supplier_name: str = "Green Motion"
    supplier_loction_type: str = "Shuttle Bus"
    product_name: str = "Kia Rio"
    doors: float = 4.0
    seats: float = 5.0
    airbags: float = 1.0
    aircon: float = 1.0
    free_cancellation: float = 1.0
    dropoff_time: float = 8.0
    pickup_time: float = 8.0
    average: float = 6.9
    cleanliness: float = 7.7
    condition: float = 7.9
    efficiency: float = 6.9
    location: float = 5.8
    value_for_money: float = 5.6
    no_of_ratings: float = 4909.0
    deposit_price: float | None = None
    drive_away_price: float | None = None

    @model_validator(mode="after")
    def validate_quote_request(self):
        if self.rental_length <= 0:
            raise ValueError("rental_length must be greater than 0")
        start = date.fromisoformat(self.start_date)
        end = date.fromisoformat(self.return_date)
        if end < start:
            raise ValueError("return_date must be on or after start_date")
        return self


class BatchQuoteRequest(BaseModel):
    items: list[QuoteRequest] = Field(..., min_length=1, max_length=50)


class OptimizeRequest(QuoteRequest):
    min_price_gbp: float = Field(default=5.0, ge=0.01)
    max_price_gbp: float = Field(default=8000.0, ge=0.01)
    step_gbp: float = Field(default=5.0, ge=0.01)
    window_pct: float = Field(default=0.5, ge=0.0, le=5.0)

    @model_validator(mode="after")
    def validate_optimize_request(self):
        if self.max_price_gbp < self.min_price_gbp:
            raise ValueError("max_price_gbp must be greater than or equal to min_price_gbp")
        return self


class AdminKillSwitchRequest(BaseModel):
    enabled: bool


class AdminGlobalCapsRequest(BaseModel):
    min_price_gbp: float = Field(5.0, ge=0.01)
    max_price_gbp: float = Field(8000.0, ge=0.01)
    max_pct_change: float = Field(0.2, ge=0.0, le=1.0)
    smoothing_alpha: float = Field(0.8, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_caps(self):
        if self.max_price_gbp < self.min_price_gbp:
            raise ValueError("max_price_gbp must be greater than or equal to min_price_gbp")
        return self


class AdminRegionOverrideRequest(BaseModel):
    region: str
    min_price_gbp: float = Field(5.0, ge=0.01)
    max_price_gbp: float = Field(8000.0, ge=0.01)
    max_pct_change: float = Field(0.2, ge=0.0, le=1.0)
    smoothing_alpha: float = Field(0.8, ge=0.0, le=1.0)
    multiplier: float = Field(1.0, ge=0.5, le=2.0)

    @field_validator("region")
    @classmethod
    def validate_region(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if not cleaned:
            raise ValueError("region is required")
        return cleaned

    @model_validator(mode="after")
    def validate_region_caps(self):
        if self.max_price_gbp < self.min_price_gbp:
            raise ValueError("max_price_gbp must be greater than or equal to min_price_gbp")
        return self


class OverridePriceRequest(BaseModel):
    listingId: str
    date: str
    price: float = Field(..., gt=0)
    reason: str | None = None

    @field_validator("date")
    @classmethod
    def validate_override_date(cls, value: str) -> str:
        date.fromisoformat(value)
        return value


class ListingSettingsRequest(BaseModel):
    minPrice: float = Field(..., gt=0)
    maxPrice: float = Field(..., gt=0)
    smartPricingEnabled: bool = True
    discounts: dict[str, float] | None = None

    @model_validator(mode="after")
    def validate_settings(self):
        if self.maxPrice < self.minPrice:
            raise ValueError("maxPrice must be greater than or equal to minPrice")
        discounts = self.discounts or {}
        for key in ("weekly", "monthly"):
            if key in discounts and not 0 <= float(discounts[key]) <= 100:
                raise ValueError(f"{key} discount must be between 0 and 100")
        return self


class AdminApprovalActionRequest(BaseModel):
    reason: str | None = None
    reviewedBy: str | None = None


def _run_quote(s: CarRentalPricingService, payload: dict) -> dict:
    cached = cache_get(payload, s.allow_proxies)
    if cached:
        return {**cached, "cache_hit": True}
    result = s.quote_row(payload)
    if result.get("source") == "fallback":
        FALLBACK_COUNTER.inc()
    to_store = {k: v for k, v in result.items() if k != "cache_hit"}
    cache_set(payload, s.allow_proxies, to_store)
    return {**result, "cache_hit": False}


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    import uuid

    rid = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    request.state.request_id = rid

    clen = request.headers.get("content-length")
    if clen is not None:
        try:
            if int(clen) > MAX_REQUEST_BYTES:
                return Response(status_code=413)
        except ValueError:
            pass

    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    return response


@app.get("/health")
def health():
    model_dir = DEFAULT_MODEL_DIR
    ready = (model_dir / "model_meta.pkl").is_file()
    return {"ok": True, "models_dir": str(model_dir), "artifacts_ready": ready}


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)


@app.get("/")
def root():
    return {
        "service": "Car rental smart pricing",
        "health": "/health",
        "metrics": "/metrics",
        "listings": "GET /listings",
        "listings_query": "GET /listings/query",
        "listings_filter_options": "GET /listings/filter-options",
        "listings_export": "GET /listings/export",
        "listing_details": "GET /listing/{id}",
        "pricing_calendar": "GET /pricing-calendar?listingId=...",
        "demand_data": "GET /demand-data?listingId=...",
        "simulation_data": "GET /simulation-data?listingId=...",
        "dashboard_export": "GET /dashboard/export",
        "override_price": "POST /override-price",
        "quote_post": "POST /quote (JSON body)",
        "quote_batch": "POST /quote/batch",
        "quote_demo_browser": "GET /quote/demo",
        "interactive_docs": "/docs",
        "admin_config": "GET /admin/config",
        "admin_review": "GET /admin/cars/review",
    }


@app.get("/listings")
def listings():
    rows, _ = _ensure_listings_cache()
    return rows


@app.get("/listings/query")
def listings_query(
    search: str | None = None,
    page: int = Query(default=1),
    pageSize: int = Query(default=20),
    city: str | None = None,
    country: str | None = None,
    group: str | None = None,
    supplierName: str | None = None,
    minPrice: float | None = None,
    maxPrice: float | None = None,
    approvalStatus: str | None = None,
    sortBy: str = "title",
    sortOrder: str = "asc",
):
    items = _filtered_listings(
        search=search,
        city=city,
        country=country,
        group=group,
        supplier_name=supplierName,
        min_price=minPrice,
        max_price=maxPrice,
        approval_status=approvalStatus,
        sort_by=sortBy,
        sort_order=sortOrder,
    )
    paginated = _paginate(items, page=page, page_size=pageSize)
    paginated["filtersApplied"] = {
        "search": search,
        "city": city,
        "country": country,
        "group": group,
        "supplierName": supplierName,
        "minPrice": minPrice,
        "maxPrice": maxPrice,
        "approvalStatus": approvalStatus,
        "sortBy": sortBy,
        "sortOrder": sortOrder,
    }
    return paginated


@app.get("/listings/filter-options")
def listings_filter_options():
    items = _filtered_listings()
    return {
        "cities": sorted({str(x.get("city", "")) for x in items if x.get("city")}),
        "countries": sorted({str(x.get("country", "")) for x in items if x.get("country")}),
        "groups": sorted({str(x.get("group", "")) for x in items if x.get("group")}),
        "suppliers": sorted({str(x.get("supplier_name", "")) for x in items if x.get("supplier_name")}),
        "approvalStatuses": ["pending", "approved", "rejected"],
    }


@app.get("/listings/export")
def listings_export(
    search: str | None = None,
    city: str | None = None,
    country: str | None = None,
    group: str | None = None,
    supplierName: str | None = None,
    minPrice: float | None = None,
    maxPrice: float | None = None,
    approvalStatus: str | None = None,
    sortBy: str = "title",
    sortOrder: str = "asc",
    format: str = "csv",
):
    items = _filtered_listings(
        search=search,
        city=city,
        country=country,
        group=group,
        supplier_name=supplierName,
        min_price=minPrice,
        max_price=maxPrice,
        approval_status=approvalStatus,
        sort_by=sortBy,
        sort_order=sortOrder,
    )
    if format.lower() == "json":
        return {"items": items, "count": len(items)}
    return _to_csv_response(
        "car-listings-export.csv",
        items,
        [
            "id",
            "title",
            "location",
            "city",
            "country",
            "group",
            "supplier_name",
            "revenue",
            "occupancyRate",
            "avgPrice",
            "currency",
            "approvalStatus",
            "approvalReason",
            "reviewedBy",
            "reviewedAt",
        ],
    )


@app.get("/listing/{listing_id}")
def listing_details(listing_id: str):
    _, by_id = _ensure_listings_cache()
    item = by_id.get(listing_id)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    settings = _current_settings_for(listing_id, item)
    return {**item, **settings, **_approval_for(listing_id)}


@app.get("/listing/{listing_id}/settings")
def listing_settings(listing_id: str):
    _, by_id = _ensure_listings_cache()
    item = by_id.get(listing_id)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    return {"listingId": listing_id, **_current_settings_for(listing_id, item)}


@app.put("/listing/{listing_id}/settings")
def update_listing_settings(listing_id: str, req: ListingSettingsRequest):
    _, by_id = _ensure_listings_cache()
    item = by_id.get(listing_id)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    if req.minPrice > req.maxPrice:
        raise HTTPException(status_code=400, detail={"message": "minPrice cannot be greater than maxPrice"})
    settings = _load_listing_settings()
    settings[listing_id] = {
        "minPrice": float(req.minPrice),
        "maxPrice": float(req.maxPrice),
        "smartPricingEnabled": bool(req.smartPricingEnabled),
        "discounts": {
            "weekly": float((req.discounts or {}).get("weekly", 10.0)),
            "monthly": float((req.discounts or {}).get("monthly", 20.0)),
        },
    }
    _save_listing_settings(settings)
    return {"success": True, "listingId": listing_id, **settings[listing_id]}


@app.get("/pricing-try-values")
def pricing_try_values(listingId: str):
    _, by_id = _ensure_listings_cache()
    item = by_id.get(listingId)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    avg_price = float(item.get("avgPrice", 80.0) or 80.0)
    return {
        "listingId": listingId,
        "suggested": {
            "minPrice": round(max(5.0, avg_price * 0.72), 2),
            "maxPrice": round(max(avg_price * 1.45, avg_price + 18), 2),
        },
    }


def _seasonal_multiplier(day: date) -> float:
    if day.month in (6, 7, 8, 12):
        base = 1.15
    elif day.month in (4, 5, 9, 10):
        base = 1.05
    else:
        base = 0.95
    if day.weekday() >= 5:
        base += 0.06
    return base


@app.get("/pricing-calendar")
def pricing_calendar(listingId: str):
    _, by_id = _ensure_listings_cache()
    item = by_id.get(listingId)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})

    start = date.today()
    days: list[dict] = []
    for i in range(365):
        d = start + timedelta(days=i)
        season = _seasonal_multiplier(d)
        final_price, _settings = _compute_calendar_price(item, listingId, d, i)
        dkey = d.isoformat()
        overrides = _load_overrides().get(listingId, {})
        demand_score = min(1.0, max(0.0, (season - 0.85) / 0.35))
        if demand_score >= 0.67:
            demand_level = "high"
        elif demand_score >= 0.34:
            demand_level = "medium"
        else:
            demand_level = "low"
        confidence = min(0.97, max(0.55, 0.82 - (0.08 if i > 180 else 0.0)))
        days.append(
            {
                "date": dkey,
                "price": round(final_price, 2),
                "demandLevel": demand_level,
                "confidenceScore": round(confidence, 2),
                "overridden": dkey in overrides,
                "currency": "GBP",
            }
        )

    return {"listingId": listingId, "days": days}


@app.get("/pricing-signals")
def pricing_signals(listingId: str, dateValue: str | None = None):
    _, by_id = _ensure_listings_cache()
    item = by_id.get(listingId)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})

    target = date.fromisoformat(dateValue) if dateValue else date.today()
    idx = max(0, (target - date.today()).days)
    price, settings = _compute_calendar_price(item, listingId, target, idx)

    season = _seasonal_multiplier(target)
    demand_score = min(1.0, max(0.0, (season - 0.85) / 0.35 + 0.05 * math.sin(idx / 5.0)))
    views = int(80 + 180 * demand_score)
    clicks = int(views * 0.34)
    favorites = int(clicks * 0.24)
    inquiries = int(clicks * 0.11)
    bookings = int(inquiries * 0.42)
    conversion = round((bookings / views) if views else 0.0, 4)

    # Similar supply estimate by city+group density.
    rows, _ = _ensure_listings_cache()
    supply_similar = sum(1 for x in rows if x.get("city") == item.get("city") and x.get("group") == item.get("group"))

    lead_days = max(0, (target - date.today()).days)
    if lead_days <= 2:
        lead_strategy = "last_minute_premium"
    elif lead_days >= 30:
        lead_strategy = "early_booking_discount"
    else:
        lead_strategy = "standard_lead_time"

    tags: list[str] = []
    if demand_score > 0.66:
        tags.append("High demand")
    if target.weekday() >= 5:
        tags.append("Weekend premium")
    if season > 1.1:
        tags.append("Peak season")
    if lead_strategy == "last_minute_premium":
        tags.append("Short lead time")
    if not tags:
        tags.append("Standard market conditions")

    return {
        "listingId": listingId,
        "date": target.isoformat(),
        "price": price,
        "hostGuardrails": {
            "minPrice": settings["minPrice"],
            "maxPrice": settings["maxPrice"],
            "applied": not (settings["minPrice"] <= price <= settings["maxPrice"]),
        },
        "demandSignals": {
            "views": views,
            "clicks": clicks,
            "favorites": favorites,
            "inquiries": inquiries,
            "bookings": bookings,
            "conversionRate": conversion,
        },
        "supplySignals": {"similarCarsAvailable": supply_similar},
        "seasonality": {
            "isWeekend": target.weekday() >= 5,
            "isPeakSeason": season > 1.1,
            "seasonalityFactor": round(season, 3),
        },
        "leadTime": {"daysAhead": lead_days, "strategy": lead_strategy},
        "explanationTags": tags,
    }


@app.get("/demand-data")
def demand_data(listingId: str):
    _, by_id = _ensure_listings_cache()
    item = by_id.get(listingId)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})

    points: list[dict] = []
    start = date.today() - timedelta(days=89)
    for i in range(90):
        d = start + timedelta(days=i)
        season = _seasonal_multiplier(d)
        score = min(1.0, max(0.0, (season - 0.85) / 0.35 + 0.05 * math.sin(i / 5.0)))
        points.append(
            {
                "date": d.isoformat(),
                "demandScore": round(score, 3),
                "searchVolume": int(80 + 140 * score),
                "bookings": int(10 + 45 * score),
            }
        )
    return {"listingId": listingId, "points": points}


@app.get("/simulation-data")
def simulation_data(listingId: str | None = None):
    rows, by_id = _ensure_listings_cache()
    if not rows:
        return {"items": [], "message": "No listings available"}
    selected_listing_id = listingId or str(rows[0].get("id"))
    item = by_id.get(selected_listing_id)
    if not item:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    settings = _current_settings_for(selected_listing_id, item)
    try_values = pricing_try_values(selected_listing_id)["suggested"]
    demand_points = demand_data(selected_listing_id)["points"][-30:]
    start_date = date.today() + timedelta(days=7)
    return_date = start_date + timedelta(days=7)
    return {
        "listingId": selected_listing_id,
        "listing": {**item, **_approval_for(selected_listing_id)},
        "defaults": {
            "city": item.get("city"),
            "country": item.get("country"),
            "group": item.get("group"),
            "startDate": start_date.isoformat(),
            "returnDate": return_date.isoformat(),
            "minPriceGbp": try_values["minPrice"],
            "maxPriceGbp": try_values["maxPrice"],
            "stepGbp": 5,
            "windowPct": 0.5,
        },
        "settings": settings,
        "pricingTryValues": try_values,
        "recentDemand": demand_points,
        "availableListings": [
            {"id": str(x.get("id")), "title": str(x.get("title", "")), "location": str(x.get("location", ""))}
            for x in rows[:100]
        ],
    }


@app.get("/dashboard/export")
def dashboard_export(
    section: str = "summary",
    format: str = "csv",
    listingId: str | None = None,
):
    section_name = section.strip().lower()
    dashboard = _dashboard_payload(_filtered_listings())

    if section_name == "summary":
        summary_rows = [{"metric": k, "value": v} for k, v in dashboard["summary"].items()]
        if format.lower() == "json":
            return {"section": "summary", "items": summary_rows}
        return _to_csv_response("dashboard-summary.csv", summary_rows, ["metric", "value"])

    if section_name == "listings":
        if format.lower() == "json":
            return {"section": "listings", "items": dashboard["items"], "count": len(dashboard["items"])}
        return _to_csv_response(
            "dashboard-listings.csv",
            dashboard["items"],
            [
                "id",
                "title",
                "location",
                "city",
                "country",
                "group",
                "supplier_name",
                "revenue",
                "occupancyRate",
                "avgPrice",
                "currency",
                "approvalStatus",
            ],
        )

    if section_name == "demand":
        target_listing_id = listingId or (dashboard["items"][0]["id"] if dashboard["items"] else None)
        if not target_listing_id:
            raise HTTPException(status_code=404, detail={"message": "Listing not found"})
        demand_rows = demand_data(str(target_listing_id))["points"]
        if format.lower() == "json":
            return {"section": "demand", "listingId": str(target_listing_id), "items": demand_rows}
        return _to_csv_response("dashboard-demand.csv", demand_rows, ["date", "demandScore", "searchVolume", "bookings"])

    raise HTTPException(status_code=400, detail={"message": "Unsupported dashboard export section"})


@app.post("/override-price")
def override_price(req: OverridePriceRequest):
    _, by_id = _ensure_listings_cache()
    if req.listingId not in by_id:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    data = _load_overrides()
    item = by_id[req.listingId]
    target = date.fromisoformat(str(req.date))
    idx = max(0, (target - date.today()).days)
    prev_price, _settings = _compute_calendar_price(item, req.listingId, target, idx)
    row = dict(data.get(req.listingId, {}))
    row[str(req.date)] = float(req.price)
    data[req.listingId] = row
    _save_overrides(data)
    _write_override_audit(
        {
            "listingId": req.listingId,
            "date": str(req.date),
            "oldPrice": prev_price,
            "newPrice": round(float(req.price), 2),
            "reason": req.reason,
        }
    )
    return {
        "success": True,
        "message": "Override saved",
        "updated": {
            "date": str(req.date),
            "price": round(float(req.price), 2),
            "demandLevel": "medium",
            "confidenceScore": 0.9,
            "overridden": True,
            "currency": "GBP",
        },
    }


@app.get("/audit-logs")
def audit_logs(listingId: str, limit: int = 100):
    return {"listingId": listingId, "items": _read_override_audit(listingId, limit=max(1, min(limit, 500)))}


@app.get("/quote")
def quote_get_help():
    return {
        "message": "Use POST with a JSON body. Opening this URL in a browser sends GET, which does not carry a body.",
        "how_to_try": {
            "swagger": "/docs — open POST /quote → Try it out",
            "browser_default_quote": "GET /quote/demo",
            "curl_empty_body_uses_defaults": (
                'curl -s -X POST http://127.0.0.1:8000/quote '
                '-H "Content-Type: application/json" -d "{}"'
            ),
        },
    }


@app.post("/quote")
@limiter.limit(os.environ.get("RATE_LIMIT_QUOTE", "60/minute"))
def quote(
    request: Request,
    req: QuoteRequest,
    _: None = Depends(verify_quote_api_key),
):
    s = get_service()
    inf = get_inference_service()
    payload = req.model_dump(exclude_none=False)

    inf.event_producer.publish(
        "pricing.quote.requested",
        inf.event_producer.build_event(
            "pricing.quote.requested",
            {"city": payload.get("city"), "country": payload.get("country"), "group": payload.get("group")},
            trace_id=getattr(request.state, "request_id", None),
        ),
    )

    base = _run_quote(s, payload)
    out = inf.quote(payload, base_quote=base)
    if "kill_switch_active" in out.get("explanation_tags", []):
        KILL_SWITCH_COUNTER.inc()
    GUARDRAIL_HITS_COUNTER.inc(len([t for t in out.get("explanation_tags", []) if t.startswith("clamped_") or t.startswith("smoothed")]))
    return out


@app.post("/quote/batch")
@limiter.limit(os.environ.get("RATE_LIMIT_BATCH", "30/minute"))
def quote_batch(
    request: Request,
    batch: BatchQuoteRequest,
    _: None = Depends(verify_quote_api_key),
):
    s = get_service()
    inf = get_inference_service()
    results = []
    for item in batch.items:
        payload = item.model_dump(exclude_none=False)
        base = _run_quote(s, payload)
        out = inf.quote(payload, base_quote=base)
        results.append(out)
    return {"results": results, "count": len(results)}


@app.post("/quote/demo")
@limiter.limit(os.environ.get("RATE_LIMIT_QUOTE", "60/minute"))
def quote_demo_post(
    request: Request,
    _: None = Depends(verify_quote_api_key),
):
    s = get_service()
    inf = get_inference_service()
    payload = QuoteRequest().model_dump(exclude_none=False)
    base = _run_quote(s, payload)
    out = inf.quote(payload, base_quote=base)
    return out


@app.get("/quote/demo")
@limiter.limit(os.environ.get("RATE_LIMIT_QUOTE", "60/minute"))
def quote_demo_get(
    request: Request,
    _: None = Depends(verify_quote_api_key),
):
    s = get_service()
    inf = get_inference_service()
    payload = QuoteRequest().model_dump(exclude_none=False)
    base = _run_quote(s, payload)
    out = inf.quote(payload, base_quote=base)
    return out


@app.post("/simulate")
@limiter.limit(os.environ.get("RATE_LIMIT_QUOTE", "60/minute"))
def simulate(
    request: Request,
    req: OptimizeRequest,
    _: None = Depends(verify_quote_api_key),
):
    s = get_service()
    inf = get_inference_service()
    payload = req.model_dump(exclude_none=False)
    booking = {k: payload[k] for k in QuoteRequest.model_fields.keys()}
    base = _run_quote(s, booking)

    out = inf.simulate(
        booking,
        base_quote=base,
        min_price_gbp=req.min_price_gbp,
        max_price_gbp=req.max_price_gbp,
        step_gbp=req.step_gbp,
        window_pct=req.window_pct,
    )
    OPTIMIZATION_CANDIDATES_COUNTER.inc(int(out.get("count", 0)))
    return out


@app.post("/optimize")
@limiter.limit(os.environ.get("RATE_LIMIT_QUOTE", "60/minute"))
def optimize(
    request: Request,
    req: OptimizeRequest,
    _: None = Depends(verify_quote_api_key),
):
    s = get_service()
    inf = get_inference_service()
    payload = req.model_dump(exclude_none=False)
    booking = {k: payload[k] for k in QuoteRequest.model_fields.keys()}
    base = _run_quote(s, booking)

    out = inf.optimize(
        booking,
        base_quote=base,
        min_price_gbp=req.min_price_gbp,
        max_price_gbp=req.max_price_gbp,
        step_gbp=req.step_gbp,
        window_pct=req.window_pct,
    )
    OPTIMIZATION_CANDIDATES_COUNTER.inc(int(out.get("optimization_candidates", 0)))
    return out


@app.get("/admin/config")
def admin_get_config(_: None = Depends(verify_admin_api_key)):
    return get_admin_store().load()


@app.get("/admin/cars/review")
def admin_review_cars(
    status: str | None = None,
    search: str | None = None,
    page: int = Query(default=1),
    pageSize: int = Query(default=20),
    _: None = Depends(verify_admin_api_key),
):
    items = _filtered_listings(
        search=search,
        approval_status=status,
        sort_by="title",
        sort_order="asc",
    )
    paginated = _paginate(items, page=page, page_size=pageSize)
    paginated["filtersApplied"] = {"status": status, "search": search}
    return paginated


@app.post("/admin/cars/{listing_id}/approve")
def admin_approve_car(
    listing_id: str,
    req: AdminApprovalActionRequest,
    _: None = Depends(verify_admin_api_key),
):
    _, by_id = _ensure_listings_cache()
    if listing_id not in by_id:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    data = _load_listing_approvals()
    data[listing_id] = {
        "approvalStatus": "approved",
        "approvalReason": req.reason,
        "reviewedBy": req.reviewedBy or "admin",
        "reviewedAt": _utc_now_iso(),
    }
    _save_listing_approvals(data)
    return {"ok": True, "listingId": listing_id, **_approval_for(listing_id)}


@app.post("/admin/cars/{listing_id}/reject")
def admin_reject_car(
    listing_id: str,
    req: AdminApprovalActionRequest,
    _: None = Depends(verify_admin_api_key),
):
    _, by_id = _ensure_listings_cache()
    if listing_id not in by_id:
        raise HTTPException(status_code=404, detail={"message": "Listing not found"})
    data = _load_listing_approvals()
    data[listing_id] = {
        "approvalStatus": "rejected",
        "approvalReason": req.reason,
        "reviewedBy": req.reviewedBy or "admin",
        "reviewedAt": _utc_now_iso(),
    }
    _save_listing_approvals(data)
    return {"ok": True, "listingId": listing_id, **_approval_for(listing_id)}


@app.post("/admin/kill-switch")
def admin_set_kill_switch(req: AdminKillSwitchRequest, _: None = Depends(verify_admin_api_key)):
    state = get_admin_store().set_kill_switch(req.enabled)
    return {"ok": True, "kill_switch": state.get("kill_switch", False)}


@app.post("/admin/global-caps")
def admin_set_global_caps(req: AdminGlobalCapsRequest, _: None = Depends(verify_admin_api_key)):
    state = get_admin_store().set_global_caps(
        min_price_gbp=req.min_price_gbp,
        max_price_gbp=req.max_price_gbp,
        max_pct_change=req.max_pct_change,
        smoothing_alpha=req.smoothing_alpha,
    )
    return {"ok": True, "global_caps": state.get("global_caps", {})}


@app.post("/admin/region-override")
def admin_set_region_override(req: AdminRegionOverrideRequest, _: None = Depends(verify_admin_api_key)):
    state = get_admin_store().set_region_override(
        req.region,
        {
            "min_price_gbp": req.min_price_gbp,
            "max_price_gbp": req.max_price_gbp,
            "max_pct_change": req.max_pct_change,
            "smoothing_alpha": req.smoothing_alpha,
            "multiplier": req.multiplier,
        },
    )
    return {"ok": True, "region": req.region, "config": state.get("regions", {}).get(req.region.lower(), {})}


from integrated_car_auth import router as integrated_auth_router

app.include_router(integrated_auth_router)
