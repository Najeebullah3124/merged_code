# Smart Commission Engine

Implementation of the `Smart Commission Engine.docx` blueprint as a runnable backend + demo UI.

## Included Capabilities

- Dynamic pricing endpoint with explainable output
- Guardrails: min/max markup and daily jump limiter
- Host controls: auto pricing, subscription tier, risk tolerance
- Admin controls: markup limits and per-listing manual price overrides
- A/B strategy split: static control vs AI variant
- Fraud guard integration (optional external Python service)
- Event ingestion API for pricing-related topics + async event processing
- In-memory feature store (demand/conversion/competitor signals) used by pricing
- Basic observability: structured request logging, request IDs, health metrics, `/metrics` route-level p95/error rates
- Prometheus export endpoint: `/metrics/prometheus`
- Basic API hardening: security headers, optional admin API key, request rate limiting
- Additional security: strict JSON content-type for mutating endpoints and prototype-poisoning payload rejection
- Idempotent event ingestion with `Idempotency-Key` support
- Durable queue processing in MongoDB (lease-based workers + retry + DLQ)
- Policy-based RBAC with external IdP introspection support
- Offline demo fallback mode when MongoDB is unavailable
- Node test suite for pricing and event-processing flows

## Quick Start

```bash
copy .env.example .env
npm install
npm run dev
```

Open:

- Demo UI: `http://localhost:3000`
- Health: `http://localhost:3000/health`

If MongoDB is unavailable, service starts in `offline-demo` mode automatically.

## Production Readiness Commands

- Run test gate: `npm test`
- Run load-test gate (local server required): `npm run loadtest`
- Run chaos campaign (with `CHAOS_ENABLED=true`): `npm run chaos`
- Build container: `docker build -t smart-commission-engine .`
- Run container: `docker run -p 3000:3000 --env-file .env smart-commission-engine`

## Environment Variables

- `MONGO_URI` default: `mongodb://127.0.0.1:27017/smart_commission_engine`
- `PORT` default: `3000`
- `ENABLE_FRAUD_SERVICE` default: `false`
- `FRAUD_SERVICE_URL` default: `http://127.0.0.1:8000/fraud-score`
- `ADMIN_API_KEY` default: empty (when set, required as `x-admin-api-key` for admin/fraud control endpoints)
- `ADMIN_JWT_SECRET` default: empty (if set, supports `Authorization: Bearer <jwt>` with `role=admin`)
- `OIDC_INTROSPECTION_URL` default: empty (if set, bearer tokens are validated against external IdP introspection)
- `OIDC_CLIENT_ID` default: empty (optional basic-auth client for introspection)
- `OIDC_CLIENT_SECRET` default: empty (optional basic-auth secret for introspection)
- `INTROSPECTION_TIMEOUT_MS` default: `2000`
- `ALLOWED_ORIGINS` default: empty (when set, only listed origins are accepted, comma-separated)
- `RATE_LIMIT_WINDOW_MS` default: `60000`
- `RATE_LIMIT_MAX_REQUESTS` default: `120`
- `ADMIN_RATE_LIMIT_WINDOW_MS` default: `60000`
- `ADMIN_RATE_LIMIT_MAX_REQUESTS` default: `30`
- `FRAUD_TIMEOUT_MS` default: `1500`
- `QUEUE_LEASE_MS` default: `30000`
- `QUEUE_POLL_MS` default: `1000`
- `QUEUE_MAX_ATTEMPTS` default: `5`
- `CHAOS_ENABLED` default: `false`

## API Summary

- `GET /health`
- `GET /metrics`
- `GET /metrics/prometheus`
- `GET /api/listings`
- `GET /api/pricing/:listingId`
- `GET /api/host/pricing-insights/:hostId`
- `PATCH /api/host/control/:hostId`
- `POST /api/admin/markup-limits`
- `POST /api/admin/price-override`
- `POST /api/fraud/events`
- `POST /api/ml/update-model`
- `GET /api/events/topics`
- `POST /api/events/ingest`
- `GET /api/experiments/summary`
- `POST /api/experiments/outcome`

Note: `POST /api/events/ingest` requires an `Idempotency-Key` header. Reusing the same key with a different payload returns `409`.

## Python Services

Fraud service:

```bash
cd python
pip install -r requirements.txt
uvicorn fraud_service:app --reload --port 8000
```

Simulation engine:

```bash
cd python
python simulation_engine.py
```

## Documentation

- Blueprint coverage and gaps: `docs/BLUEPRINT_COVERAGE.md`
- Detailed API reference: `docs/API_REFERENCE.md`
- Architecture and runtime flow: `docs/ARCHITECTURE.md`
- Production control evidence: `docs/PRODUCTION_EVIDENCE.md`
- Alert rules: `ops/alerts/prometheus-rules.yml`
- Dashboard: `ops/dashboards/grafana-smart-commission.json`
- Kubernetes manifests: `infra/k8s/`
