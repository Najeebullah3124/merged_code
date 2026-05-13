# Backend API reference — one-platform

This document lists **every HTTP route** implemented in the merged one-platform backends: the NestJS core API, the car-rental FastAPI service, the Airbnb smart-pricing FastAPI service, the subscription / ranking FastAPI service, and the SEO API gateway. It describes what each route does and what it returns (success shapes and notable errors).

Every path below can be turned into a **full URL** by prefixing the correct **base** (scheme `http://` or `https://`, host, optional port, no trailing slash except site root). For local development use **`http://localhost`** or **`http://127.0.0.1`** interchangeably. Do **not** use `www.localhost` — it is not a standard loopback host and may not resolve.

---

## Full URL bases (copy-paste examples)

### Integrated stack — Docker Compose `frontend` (nginx on host port **80**)

Use **`http://localhost`** (same as **`http://127.0.0.1`**, port **80** implied). Examples:

| Route (doc) | Full URL |
|-------------|----------|
| Nest `GET /api/health` | `http://localhost/api/health` |
| Nest `GET /api/platforms` | `http://localhost/api/platforms` |
| Nest `POST /api/bookings` | `http://localhost/api/bookings` |
| Car `GET /listings` (nginx adds `/api`, then strips for upstream) | `http://localhost/api/listings` |
| Car `GET /docs` (Swagger — **not** in current `frontend/nginx.conf` regex; use direct port or `proxy/nginx.conf` `car-api`) | `http://localhost:8000/docs` if car is bound to host **or** `http://localhost/car-api/docs` |
| Car `POST /quote` | `http://localhost/api/quote` |
| Car `POST /auth/login` | `http://localhost/api/auth/login` |
| Airbnb `GET /api/health` (nginx: `/api/airbnb/` + remainder → `/api/...` on service) | `http://localhost/api/airbnb/health` |
| Airbnb `GET /api/listings` | `http://localhost/api/airbnb/listings` |
| Airbnb `GET /api/pricing/{id}` | `http://localhost/api/airbnb/pricing/12345` |

Swagger / OpenAPI: **Airbnb** via integrated nginx → **`http://localhost/api/airbnb/docs`**. **Car** Swagger is only at **`http://localhost/api/docs`** if you extend the nginx `location` regex to include `docs` / `metrics` / `openapi.json` / `redoc`; otherwise use **`http://localhost:8000/docs`** (direct) or **`http://localhost/car-api/docs`** (`proxy/nginx.conf`).

### Direct to services (no SPA nginx — typical local dev)

| Service | Base (prepend to path column in each section) | Example full URL |
|---------|-----------------------------------------------|------------------|
| NestJS | `http://localhost:3000` | `http://localhost:3000/api/health` |
| Car FastAPI | `http://localhost:8000` | `http://localhost:8000/health` |
| Airbnb FastAPI | `http://localhost:8000` (uvicorn default in Dockerfile) | `http://localhost:8000/api/health` |
| Subplan / ranking | `http://localhost:8080` (typical; set when you run uvicorn) | `http://localhost:8080/health` |
| SEO gateway | `http://localhost:5000` (`GATEWAY_PORT` default) | `http://localhost:5000/health` |

### Alternative reverse proxy (`proxy/nginx.conf` — not the root `frontend/nginx.conf`)

| Logical API | Example full URL on that proxy |
|-------------|-------------------------------|
| Booking Nest (global prefix already `/api` on the app) | `http://localhost/booking-api/api/health` |
| Car FastAPI | `http://localhost/car-api/health` |
| Airbnb FastAPI | `http://localhost/airbnb-api/api/health` |
| SEO gateway | `http://localhost/seo-api/health` |
| Subplan / ranking | `http://localhost/subplan-api/health` |

---

**How traffic reaches each service (integrated Docker + root `frontend/nginx.conf`):**

| Public URL prefix (browser / SPA) | Upstream service | Notes |
|----------------------------------|------------------|--------|
| `/api/...` (except car + airbnb rules below) | NestJS backend `:3000` | Global API prefix is `api`. Full example: `http://localhost/api/health` |
| `/api/listings`, `/api/quote`, `/api/auth/login`, … (see nginx `location`) | Car FastAPI `:8000` | Nginx strips `/api` before proxying. Example: `http://localhost/api/listings` |
| `/api/airbnb/...` | Airbnb FastAPI | Rewritten to `/api/...` on the Airbnb container. Example: `http://localhost/api/airbnb/health` → upstream `GET /api/health` |

Alternative full-stack proxy (`proxy/nginx.conf`) uses paths like `/booking-api/`, `/car-api/`, `/airbnb-api/`, `/seo-api/`, `/subplan-api/` — same handlers, different prefixes (full examples in table above).

---

## 1. NestJS core backend (`backend/`, default port `3000`, global prefix `/api`)

**Bases:** **`http://localhost:3000`** (direct) · **`http://localhost`** (via integrated SPA nginx on port 80 — same paths: `/api/...`).

All routes below are served as **`/api` + path** (e.g. `GET /api/health` → **`http://localhost:3000/api/health`** or **`http://localhost/api/health`**).

### `GET /api`

- **Purpose:** Service identification for the deterministic booking core.
- **Returns:** JSON `{ name, layer, docs }` — e.g. `name: "SwyftBooking API"`, `layer: "deterministic-core"`, `docs: "/api"`.

### `GET /api/health`

- **Purpose:** Liveness / basic health of the NestJS process.
- **Returns:** `{ status: "ok", service: "swyftbooking-backend" }`.

### `GET /api/ai-health`

- **Purpose:** Check connectivity to the configured AI microservice (`AiClientService.health()` — POSTs to that service’s `/health`).
- **Returns:** On success `{ status: "ok", ai: <payload from AI service> }`. On failure `{ status: "degraded", ai: { status: "unreachable" } }`.

### `GET /api/kafka-health`

- **Purpose:** Report whether the Kafka client thinks it is connected.
- **Returns:** `{ status: "ok" | "degraded" }` (`ok` when `kafka.isConnected()` is true).

### `GET /api/platforms`

- **Purpose:** Discovery manifest for merged modules (booking, car, airbnb, seo, subplan) with rough route hints.
- **Returns:** JSON with `oneBackend`, `oneFrontend`, and `modules` array (each item has `id`, `name`, `runtime`, `status`, optional `routes` / `source`).

### `GET /api/platforms/:id`

- **Purpose:** Per-platform detail for `booking`, `car`, `airbnb`, `seo`, or `subplan`.
- **Returns:** `{ id, ... }` with module-specific fields; if `id` is unknown, `{ status: "not_found", id }`.

### `GET /api/seo/:slug`

- **Purpose:** Stub SEO page payload for a slug (parses `flights-from-X-to-Y` pattern when possible).
- **Returns:** `{ slug, from, to, content, faqs[], internal_links[] }`.

### `GET /api/pricing/:route`

- **Purpose:** Stub route-level “current price” for flight-style route codes.
- **Returns:** `{ route, current_price, currency, trend_7d_pct }` (deterministic from route string length).

### `GET /api/predict/:route`

- **Purpose:** Stub 7-day trend / recommendation for a route code.
- **Returns:** `{ route, trend, confidence, recommendation }`.

### `POST /api/track`

- **Purpose:** Accept a generic analytics-style event body.
- **Returns:** `{ ok: true, received: { event, timestamp } }` (timestamp defaults to now if omitted).

### `POST /api/bookings`

- **Purpose:** Create a booking with idempotency, decision-engine evaluation, distributed lock, availability check, Kafka emits, and sync orchestration.
- **Body:** `CreateBookingDto`: `listingId`, `guestId`, `startDate`, `endDate` (ISO date strings), `idempotencyKey` (required), optional `platform`, optional `price`.
- **Returns (success):** `{ booking: <document>, idempotent: boolean }`. `idempotent: true` when the same `idempotencyKey` was already processed (returns stored booking).
- **Errors:** `409 Conflict` for invalid date range, decision `block`, lock failure, or date conflict; `429 Too Many Requests` when decision outcome is `delay` (body includes `reason`, `retryAfterSeconds`, `risk`).

### `GET /api/bookings/listing/:listingId`

- **Purpose:** List all bookings for a listing, sorted by `startDate` ascending.
- **Returns:** Array of booking documents (lean Mongo documents or empty array).

### `GET /api/bookings/:id`

- **Purpose:** Fetch one booking by MongoDB `_id`.
- **Returns:** Booking document or `null` / not found per Mongoose behavior.

---

## 2. Car rental smart pricing — FastAPI (`car-api/car_rental_api.py`, port `8000`)

**Bases:** **`http://localhost:8000`** (direct uvicorn) · **`http://localhost/api`** (integrated SPA nginx: append path **without** duplicating `api` for routes that start at `/` — e.g. `/listings` → **`http://localhost/api/listings`**). Alternative proxy: **`http://localhost/car-api`** (see `proxy/nginx.conf`).

Unless `SWYFT_INTEGRATED_CAR=1`, quote routes expect **`X-API-Key`** when `QUOTE_API_KEY` / `API_KEY` is set. Admin routes expect **`X-Admin-Key`** matching `ADMIN_API_KEY` (if unset, admin mutations return **403**).

When integrated behind one-platform nginx, public paths are prefixed with **`/api`** (e.g. `/api/listings` → upstream `/listings`).

### Framework / observability (FastAPI)

| Method | Path | Purpose | Returns |
|--------|------|---------|---------|
| GET | `/docs` | Swagger UI | HTML |
| GET | `/redoc` | ReDoc | HTML |
| GET | `/openapi.json` | OpenAPI schema | JSON |
| GET | `/metrics` | Prometheus metrics (instrumentator + app counters) | Prometheus text |

### `GET /health`

- **Purpose:** Service health and whether model artifacts exist under the default model dir.
- **Returns:** `{ ok, models_dir, artifacts_ready }`.

### `GET /favicon.ico`

- **Purpose:** Silence browser favicon requests.
- **Returns:** `204 No Content`.

### `GET /`

- **Purpose:** Service index with pointers to main routes.
- **Returns:** JSON map of service name and path hints.

### `GET /listings`

- **Purpose:** Return aggregated listing rows built from the CSV (`car rental sample_augmented_demo.csv`); empty list if file missing.
- **Returns:** JSON array of listing objects (`id`, `title`, `location`, `city`, `avgPrice`, etc.).

### `GET /listing/{listing_id}`

- **Purpose:** Single listing plus merged saved settings.
- **Returns:** Listing fields + current min/max/smart pricing/discounts.
- **Errors:** `404` if id unknown.

### `GET /listing/{listing_id}/settings`

- **Purpose:** Host guardrail settings only.
- **Returns:** `{ listingId, minPrice, maxPrice, smartPricingEnabled, discounts }`.
- **Errors:** `404` if listing not found.

### `PUT /listing/{listing_id}/settings`

- **Purpose:** Update persisted listing settings (`runtime/listing_settings.json`).
- **Body:** `minPrice`, `maxPrice`, `smartPricingEnabled`, optional `discounts` with `weekly` / `monthly`.
- **Returns:** `{ success, listingId, ...settings }`.
- **Errors:** `400` if `minPrice > maxPrice`; `404` if listing missing.

### `GET /pricing-try-values`

- **Query:** `listingId` (required).
- **Purpose:** Suggested min/max try band for the UI.
- **Returns:** `{ listingId, suggested: { minPrice, maxPrice } }`.
- **Errors:** `404` if listing missing.

### `GET /pricing-calendar`

- **Query:** `listingId` (required).
- **Purpose:** ~365 days of daily prices, demand level, confidence, override flags.
- **Returns:** `{ listingId, days: [{ date, price, demandLevel, confidenceScore, overridden, currency }, ...] }`.
- **Errors:** `404` if listing missing.

### `GET /pricing-signals`

- **Query:** `listingId` (required), optional `dateValue` (ISO date).
- **Purpose:** Rich explanation payload for a single day (demand, supply, seasonality, lead time, tags).
- **Returns:** `{ listingId, date, price, hostGuardrails, demandSignals, supplySignals, seasonality, leadTime, explanationTags }`.
- **Errors:** `404` if listing missing.

### `GET /demand-data`

- **Query:** `listingId` (required).
- **Purpose:** ~90 days of historical-style demand points for charts.
- **Returns:** `{ listingId, points: [{ date, demandScore, searchVolume, bookings }, ...] }`.
- **Errors:** `404` if listing missing.

### `POST /override-price`

- **Purpose:** Set a manual daily price override (`runtime/price_overrides.json`) and append audit.
- **Body:** `listingId`, `date`, `price`, optional `reason`.
- **Returns:** `{ success, message, updated: { date, price, demandLevel, confidenceScore, overridden, currency } }`.
- **Errors:** `404` if listing missing.

### `GET /audit-logs`

- **Query:** `listingId` (required), optional `limit` (capped).
- **Purpose:** Recent override audit lines for a listing.
- **Returns:** `{ listingId, items: [...] }`.

### `GET /quote`

- **Purpose:** Instructions (GET cannot send JSON body for real quotes).
- **Returns:** JSON with `message` and `how_to_try` (Swagger, `/quote/demo`, curl example).

### `POST /quote`

- **Purpose:** Single rental quote through `CarRentalPricingService` + `InferenceService` (guardrails, kill switch, cache).
- **Body:** `QuoteRequest` — large set of optional rental features (defaults filled). Rate limit from env `RATE_LIMIT_QUOTE` (default `60/minute`).
- **Returns:** Quote result object from inference layer (includes priced fields, explanations, `cache_hit`, etc.; may increment kill-switch / guardrail metrics).

### `POST /quote/batch`

- **Purpose:** Up to 50 quotes in one request.
- **Returns:** `{ results: [...], count }`.
- **Rate limit:** `RATE_LIMIT_BATCH` (default `30/minute`).

### `POST /quote/demo` and `GET /quote/demo`

- **Purpose:** Quote using default `QuoteRequest` values (browser-friendly on GET).
- **Returns:** Same shape as `POST /quote` success.

### `POST /simulate`

- **Purpose:** Scan candidate prices in a window (`OptimizeRequest` extends `QuoteRequest` with min/max/step/`window_pct`) for exploration.
- **Returns:** Object from `InferenceService.simulate` (includes candidate grid stats and `count`).

### `POST /optimize`

- **Purpose:** Optimization pass over candidate prices.
- **Returns:** Object from `InferenceService.optimize` (includes `optimization_candidates` count).

### `GET /admin/config`

- **Auth:** `X-Admin-Key` when not in integrated mode.
- **Purpose:** Load admin controls store (`AdminControlsStore`).
- **Returns:** Current admin JSON state.

### `POST /admin/kill-switch`

- **Body:** `{ enabled: boolean }`.
- **Returns:** `{ ok, kill_switch }`.

### `POST /admin/global-caps`

- **Body:** `min_price_gbp`, `max_price_gbp`, `max_pct_change`, `smoothing_alpha`.
- **Returns:** `{ ok, global_caps }`.

### `POST /admin/region-override`

- **Body:** `region` plus cap fields and `multiplier`.
- **Returns:** `{ ok, region, config }`.

### Car auth router (`integrated_car_auth.py`, prefix `/auth`)

### `POST /auth/login`

- **Body:** `username` (default `"admin"`), `password`.
- **Purpose:** If `SWYFT_CAR_UI_PASSWORD` is set, password must match; issues JWT-shaped token.
- **Returns:** `{ access_token, token_type: "bearer" }`.

### `POST /auth/refresh`

- **Purpose:** Issue a new token without credential check.
- **Returns:** `{ access_token, token_type: "bearer" }`.

---

## 3. Airbnb smart pricing — FastAPI (`smart Prcing Airbnb/backend/main.py` in Docker; mirrored by `backend/src/modules/airbnb_python/main.py`)

**Bases:** **`http://localhost:8000`** (direct to FastAPI; paths in this service already start with `/api/...`, e.g. **`http://localhost:8000/api/health`**) · **`http://localhost/api/airbnb`** (integrated SPA nginx: **drop the first `/api`** from the app path when building the browser URL — e.g. app route `/api/health` → **`http://localhost/api/airbnb/health`**, not `.../api/airbnb/api/health`). Alternative proxy: **`http://localhost/airbnb-api`**, e.g. **`http://localhost/airbnb-api/api/health`**.

Container listens on port **8000** inside the published Docker image; compose may expose a different host port for debugging. Routes are under **`/api/...`**. Rate limits use `slowapi` where decorated.

**Admin routes** (`/api/host/settings/...`, `/api/admin/...`) require **`Authorization: Bearer <JWT>`** with role `admin` (from `POST /api/auth/login`). JWT secret/algorithm: `SMART_PRICING_JWT_SECRET`, `SMART_PRICING_JWT_ALG`.

### `GET /api/health`

- **Returns:** `{ status: "ok" }`.

### `POST /api/auth/login`

- **Body:** `{ username, password }`. Demo defaults `admin`/`admin`, overridable via `SMART_PRICING_ADMIN_USER` / `SMART_PRICING_ADMIN_PASS`.
- **Returns:** `{ access_token, token_type: "bearer", role: "admin" }`.
- **Errors:** `401` invalid credentials. Rate limit `10/minute`.

### `GET /api/listings`

- **Query:** `limit` (default 80, max 500).
- **Returns:** `{ listings: [{ id, name, neighbourhood, neighbourhood_group, room_type, price }, ...] }` from CSV or embedded fallback rows.
- **Rate limit:** `60/minute`.

### `GET /api/pricing/{listing_id}`

- **Query:** `days` (7–90, default 60), optional `from_date` (ISO).
- **Purpose:** Full pricing calendar with host prefs, kill-switch awareness, publish `pricing.viewed` event.
- **Returns:** `{ listing: {...}, settings, suggested_try_price, kill_switch_active, calendar: [...] }`.
- **Errors:** `404` listing not found. Rate limit `60/minute`.

### `POST /api/host/settings/{listing_id}`

- **Auth:** Bearer admin.
- **Body:** Smart pricing toggles, min/max/base, goals, risk, dates lists.
- **Returns:** `{ ok: true, settings }`.
- **Errors:** `400` validation; `401`/`403` auth. Rate limit `30/minute`.

### `POST /api/simulation/run`

- **Body:** `{ listing_id, custom_price }`.
- **Purpose:** Booking probability + expected revenue for a custom price; optional ML conversion model; `decision_engine` block when model returns.
- **Returns:** `{ listing_id, custom_price, booking_probability, expected_revenue, top_alternatives, decision_engine }`.
- **Errors:** `404` listing not found. Rate limit `60/minute`.

### `GET /api/admin/status`

- **Auth:** Bearer admin.
- **Returns:** `{ kill_switch, regional_override, listings_loaded, recent_audit }`.
- **Rate limit:** `30/minute`.

### `POST /api/admin/kill-switch`

- **Auth:** Bearer admin.
- **Body:** `{ enabled, region? }`.
- **Returns:** `{ ok, kill_switch }`.
- **Rate limit:** `30/minute`.

### Static / root (when `SMART_PRICING_WEB_DIST` points to a built folder)

- **`GET /`** — Serves static SPA; if no dist, fallback handler returns JSON with API name and `/docs` hint.

### FastAPI docs

- **`GET /docs`**, **`GET /redoc`**, **`GET /openapi.json`** — standard OpenAPI surfaces.

### Metrics

- **`GET /metrics`** — Prometheus metrics via `prometheus_fastapi_instrumentator` (same pattern as car API; `include_in_schema=False` in code).

---

## 4. Subscription / ranking intelligence — FastAPI (`backend/src/modules/subplan_python/main.py`)

**Bases:** **`http://localhost:8080`** (typical direct run, e.g. uvicorn `--port 8080`) · **`http://localhost/subplan-api`** when behind `proxy/nginx.conf`, e.g. **`http://localhost/subplan-api/health`**, **`http://localhost/subplan-api/v1/rank/score`**.

Typical port **8080** when deployed as `rank-api` behind `proxy/nginx.conf` (`/subplan-api/` → upstream root). Adds **`X-Process-Time-Ms`** on responses.

### `GET /health`

- **Returns:** `HealthResponse` — `{ status: "ok", version: "1.1.0" }`.

### `GET /metrics`

- **Purpose:** Minimal Prometheus-style text metrics (`rank_requests_total`, `events_ingested_total`, `anomaly_alerts_total`).
- **Returns:** `text/plain` exposition format.

### `POST /v1/rank/score`

- **Body:** `RankScoreRequest` — `query_id`, optional `user_id` / `session_id` / `device_type`, `candidates` (max 500 `CandidateListing` items).
- **Purpose:** Rank listings via `DecisionOrchestrator`.
- **Returns:** `RankScoreResponse` — `{ ranked: [{ listing_id, final_score, components }], model_versions }`. Header **`X-Model-Version`**.

### `GET /v1/models/info`

- **Returns:** `{ models: <orchestrator model_versions map> }`.

### `GET /v1/hosts/{host_id}/promote/recommendations`

- **Query:** `limit` (default 10).
- **Returns:** `{ host_id, limit, items: [], ranking_impact_prediction_note }` (stub).

### `GET /v1/hosts/{host_id}/intelligence/dashboard`

- **Returns:** Host dashboard stub with `suggested_listings_to_promote`, null metrics, and example `performance_insights`.

### `POST /v1/events`

- **Status:** `202 Accepted`.
- **Body:** `EventIngest` (idempotency key, event type, listing, timestamps, optional fraud signals).
- **Returns:** `{ status: "accepted", anomaly_score, exclude_from_training, ... }` and optional `alert_admin` / `alert_channel` when anomalous.

### `POST /v1/admin/alerts/test`

- **Returns:** `{ status: "noop", detail: "Wire to PagerDuty/Slack" }`.

### FastAPI docs

- **`GET /docs`**, **`GET /redoc`**, **`GET /openapi.json`**.

---

## 5. SEO API gateway — Express (`backend/src/modules/seo_gateway/index.js`, default port `5000`)

**Base:** **`http://localhost:5000`** (override with `GATEWAY_PORT`). Integrated SEO proxy in `proxy/nginx.conf`: **`http://localhost/seo-api`**, e.g. **`http://localhost/seo-api/health`**, **`http://localhost/seo-api/docs`**.

This process **proxies** to other services; only some paths are implemented locally.

### `GET /health`

- **Returns:** `{ ok: true, targets }` where `targets` lists configured upstream base URLs (`seo`, `ai`, `pricing`, `prediction`, `analytics`).

### `GET /docs`

- **Returns:** JSON describing gateway name and **high-level** proxied paths (not exhaustive of upstream).

### `GET /metrics`

- **Returns:** Prometheus default registry metrics for the gateway process (`Content-Type` from `prom-client`).

### `GET /api/seo/:slug`

- **Validation:** slug must match `^[a-z0-9-]+$`, length 3–200; else `400 { error: "Invalid input" }`.
- **Behavior:** Proxied to `SEO_SERVICE_URL` with path rewrite stripping `/api/seo`. Response is whatever the SEO service returns; on upstream failure **`502 { error: "Upstream unavailable" }`**.

### `POST /api/ai/*`

- **Behavior:** Proxied to `AI_SERVICE_URL` (prefix `/api/ai` removed). Rate limit stricter (`AI_RATE_LIMIT_PER_MINUTE`, default 30/min shared store).

### `GET /api/pricing/history/:route` and `GET /api/pricing/:route` and related

- **Validation:** `route` must match `^[A-Z0-9]{3}-[A-Z0-9]{3}$` after transform (e.g. `NYC-MIA`); else `400`.
- **`POST /api/pricing/ingest`:** Requires header **`x-admin-key`** matching `ADMIN_API_KEY`; if key not configured, **`503`**.
- **Behavior:** Proxied to `PRICING_SERVICE_URL`.

### `GET /api/predict/:route`

- **Validation:** Same route code pattern as pricing.
- **Behavior:** Proxied to `PREDICTION_SERVICE_URL`.

### `POST /api/track`

- **Auth:** **`x-admin-key`** required (same as ingest).
- **Behavior:** Proxied to analytics service with rewrite to `/track` on upstream.

### Global middleware

- **Rate limiting:** Redis-backed limits on `/api` (default 120/min per IP per path); **`429`** with `error`, `retry_after_seconds` when exceeded.
- **Request ID:** `X-Request-Id` header on responses.

---

## 6. Quick index — route counts

| Component | Routes (hand-written handlers + auth router + standard FastAPI docs/metrics) |
|-----------|--------------------------------------------------------------------------------|
| NestJS | 15 (`GET/POST` on `/api` tree) |
| Car FastAPI | 28 handler paths + `/auth/*` (2) + instrumentator `/metrics` + `/docs` `/openapi.json` `/redoc` |
| Airbnb FastAPI | 10 business routes + conditional `/` + docs + prometheus |
| Subplan FastAPI | 9 routes + docs |
| SEO gateway | 5 local routes + all proxied `/api/*` paths listed above |

---

*Generated from repository source. If you add a new controller or `@app` route, update this file to keep the “no skipped endpoints” guarantee.*
