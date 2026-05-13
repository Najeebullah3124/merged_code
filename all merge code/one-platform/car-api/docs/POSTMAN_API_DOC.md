# Car Service Postman Guide

This document explains how to use the included Postman collection for `car-api`.

## Files

- Collection JSON: `docs/car_api_postman_collection.json`
- This guide: `docs/POSTMAN_API_DOC.md`

## Import into Postman

1. Open Postman.
2. Click **Import**.
3. Choose `docs/car_api_postman_collection.json`.
4. Import.

## Configure variables

In the imported collection, open **Variables** and set:

- `baseUrl`  
  - Local direct API: `http://127.0.0.1:8000`
  - Via one-platform frontend/nginx: `http://localhost/api`
- `apiKey` (optional; required only if `API_KEY`/`QUOTE_API_KEY` enabled)
- `adminKey` (required for `/admin/*` when `ADMIN_API_KEY` is configured)
- `listingId` (example listing id for listing/pricing endpoints)

## Endpoint groups in collection

- Health & Index
  - `GET /health`
  - `GET /`
- Listings
  - `GET /listings`
  - `GET /listing/{listing_id}`
  - `GET /listing/{listing_id}/settings`
  - `PUT /listing/{listing_id}/settings`
- Pricing & Demand
  - `GET /pricing-try-values?listingId=...`
  - `GET /pricing-calendar?listingId=...`
  - `GET /pricing-signals?listingId=...`
  - `GET /demand-data?listingId=...`
- Override & Audit
  - `POST /override-price`
  - `GET /audit-logs?listingId=...`
- Quote / Simulate / Optimize
  - `GET /quote`
  - `POST /quote`
  - `POST /quote/batch`
  - `POST /quote/demo`
  - `GET /quote/demo`
  - `POST /simulate`
  - `POST /optimize`
- Admin
  - `GET /admin/config`
  - `POST /admin/kill-switch`
  - `POST /admin/global-caps`
  - `POST /admin/region-override`

## Notes

- If using `http://localhost/api` as `baseUrl`, requests map through your frontend proxy.
- If using `http://127.0.0.1:8000` as `baseUrl`, requests hit `car-api` directly.
- For admin requests, make sure `X-Admin-Key` matches your `ADMIN_API_KEY` env value.
- For quote requests (when key enforcement is enabled), `X-API-Key` must match.

## Live Validation

Validated against:

- `https://dev-model.swyftbooking.com/api`

Passed in live checks:

- `GET /health`
- `GET /listings`
- `GET /listing/{listingId}` (with a real listing id from `/listings`)
- `GET /pricing-calendar?listingId=...`
- `GET /demand-data?listingId=...`
- `POST /quote`
- `GET /quote/demo`
- `POST /simulate`

Note:

- `404` on listing-based routes usually means test ID is not valid; fetch a real `id` from `GET /listings` first.

### Admin auth check (live)

- `GET /admin/config` returned `200` without `X-Admin-Key`
- `POST /admin/kill-switch` returned `200` without `X-Admin-Key`

So on current live environment, admin key protection appears not enforced.
