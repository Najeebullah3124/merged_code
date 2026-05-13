# Production Evidence Pack

This repository now includes concrete artifacts for production controls:

## 1) Enterprise IAM and RBAC

- Policy-based permission mapping: `src/config/rbacPolicy.json`
- Permission enforcement middleware: `src/middleware/rbac.js`
- Security gateway supports:
  - local HS256 JWT validation (`ADMIN_JWT_SECRET`)
  - external IdP token introspection (`OIDC_INTROSPECTION_URL`)
  - API key fallback for break-glass admin access

## 2) SRE observability and alerting artifacts

- Route metrics endpoint: `GET /metrics`
- Prometheus exposition endpoint: `GET /metrics/prometheus`
- Alert rules: `ops/alerts/prometheus-rules.yml`
- Dashboard template: `ops/dashboards/grafana-smart-commission.json`

## 3) Multi-environment deployment controls

- Kubernetes manifests:
  - Base: `infra/k8s/base/`
  - Staging overlays: `infra/k8s/staging/`
  - Production overlays: `infra/k8s/production/`
- Progressive deployment workflows:
  - Staging deploy: `.github/workflows/deploy-staging.yml`
  - Production deploy + rollback: `.github/workflows/deploy-production.yml`

## 4) Chaos and resilience evidence

- Chaos injection middleware (non-prod): `src/middleware/chaos.js`
- Formal chaos campaign runner: `tools/chaos.js`
- Load gate runner: `tools/loadtest.js`

## Validation checklist

- `npm test`
- `npm run loadtest`
- `CHAOS_ENABLED=true npm run chaos`
