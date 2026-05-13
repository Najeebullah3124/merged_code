# One Platform - Full Postman API Doc

This pack covers **all main APIs** in `one-platform`:

- Booking/Nest backend (`/api/*`)
- Car pricing API (proxied under `/api/*`)
- Airbnb pricing API (proxied under `/api/airbnb/*`)

## Files

- `docs/one_platform_postman_collection.json` (import this in Postman)
- `docs/ONE_PLATFORM_POSTMAN_DOC.md` (this guide)

## Import Steps

1. Open Postman
2. Click **Import**
3. Select `one-platform/docs/one_platform_postman_collection.json`
4. Import

## Collection Variables

- `baseUrl`: `http://localhost`
- `backendApiBase`: `{{baseUrl}}/api`
- `carApiBase`: `{{baseUrl}}/api`
- `airbnbApiBase`: `{{baseUrl}}/api/airbnb`
- `apiKey`: optional for car quote routes if key is enforced
- `adminKey`: admin key for car admin endpoints
- `airbnbToken`: bearer token from Airbnb login
- `listingId`: sample id for listing-related routes
- `bookingId`: sample booking id

## Endpoint Coverage

### Backend (Nest)

- `GET /api`
- `GET /api/health`
- `GET /api/ai-health`
- `GET /api/kafka-health`
- `GET /api/platforms`
- `GET /api/platforms/{id}`
- `GET /api/seo/{slug}`
- `GET /api/pricing/{route}`
- `GET /api/predict/{route}`
- `POST /api/track`
- `POST /api/bookings`
- `GET /api/bookings/listing/{listingId}`
- `GET /api/bookings/{id}`

### Car API (proxied)

- `GET /api/health`
- `GET /api/listings`
- `GET /api/listing/{listing_id}`
- `GET /api/listing/{listing_id}/settings`
- `PUT /api/listing/{listing_id}/settings`
- `GET /api/pricing-try-values`
- `GET /api/pricing-calendar`
- `GET /api/pricing-signals`
- `GET /api/demand-data`
- `POST /api/override-price`
- `GET /api/audit-logs`
- `GET /api/quote`
- `POST /api/quote`
- `POST /api/quote/batch`
- `POST /api/quote/demo`
- `GET /api/quote/demo`
- `POST /api/simulate`
- `POST /api/optimize`
- `GET /api/admin/config`
- `POST /api/admin/kill-switch`
- `POST /api/admin/global-caps`
- `POST /api/admin/region-override`

### Airbnb API (proxied)

- `GET /api/airbnb/health`
- `POST /api/airbnb/auth/login`
- `GET /api/airbnb/listings`
- `GET /api/airbnb/pricing/{listing_id}`
- `POST /api/airbnb/host/settings/{listing_id}`
- `POST /api/airbnb/simulation/run`
- `GET /api/airbnb/admin/status`
- `POST /api/airbnb/admin/kill-switch`

## Auth Notes

- Car quote key: header `X-API-Key: {{apiKey}}` (only if configured in env)
- Car admin key: header `X-Admin-Key: {{adminKey}}`
- Airbnb admin routes/settings use bearer token:
  - run `POST /api/airbnb/auth/login`
  - copy `access_token` to `airbnbToken`
  - use header `Authorization: Bearer {{airbnbToken}}`

## Live Validation (Postman-Style)

Validated against:

- `https://dev-model.swyftbooking.com`

### Passed

- Backend: `GET /api/health`, `GET /api/platforms`
- Car: `GET /api/listings`, `GET /api/listing/{listingId}`, `GET /api/pricing-calendar`, `GET /api/demand-data`, `POST /api/quote`, `GET /api/quote/demo`, `POST /api/simulate`
- Airbnb: `GET /api/airbnb/health`, `GET /api/airbnb/listings`, `GET /api/airbnb/pricing/{listingId}`


## Auth-Protected Validation (Live)

Additional live checks were executed for admin/auth flows.

### Car admin endpoints

- `GET /api/admin/config` -> `200` **without** `X-Admin-Key`
- `POST /api/admin/kill-switch` -> `200` **without** `X-Admin-Key`
- `GET /api/admin/config` -> `200` with bad `X-Admin-Key`

Current live behavior indicates car admin key enforcement is not enabled on this environment.

### Airbnb auth/admin endpoints

- `POST /api/airbnb/auth/login` with `admin/admin` -> `200` (token issued)
- `GET /api/airbnb/admin/status` with bearer token -> `200`
- `POST /api/airbnb/admin/kill-switch` with bearer token -> `200`
- `GET /api/airbnb/admin/status` without token -> `200`

Current live behavior indicates Airbnb admin endpoints are also accessible without token on this environment.
