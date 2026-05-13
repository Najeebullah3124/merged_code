# API Reference

Base URL: `http://localhost:3000`

## Health

- `GET /health`
- Returns service state and current mode (`mongodb` or `offline-demo`)

## Listings

- `GET /api/listings`
- Returns available listings used for pricing demos

## Pricing

- `GET /api/pricing/:listingId`
- Query params:
  - `demandScore` number
  - `elasticityScore` number
  - `conversionProbability` number
  - `hostScore` number (optional override)
  - `competitorGap` number
  - `userId` string
  - `variant` `control_static|variant_ai` (optional)
- Returns:
  - `base_price`, `markup`, `final_price`
  - `explanation[]`
  - `breakdown`
  - `fee_range_preview`
  - `optimization_tip`
  - `experiment`
  - `fraud_guard`

## Host

- `GET /api/host/pricing-insights/:hostId`
- `PATCH /api/host/control/:hostId`
  - Body fields (optional):
    - `auto_pricing_enabled` boolean
    - `subscription_tier` `standard|premium`
    - `risk_tolerance` `conservative|balanced|aggressive`

## Admin

- `POST /api/admin/markup-limits`
  - Body:
    - `min_markup`
    - `max_markup`
- `POST /api/admin/price-override`
  - Body:
    - `listing_id`
    - `final_price`
    - `reason` optional
    - `expires_at` ISO timestamp optional

## Fraud

- `POST /api/fraud/events`
  - Body:
    - `listing_id`, `host_id`, `user_id`, `event_type`
    - `fraud_score` (0-1)
    - `risk_level` (`low|medium|high|critical`)
    - `exclude_from_training`
    - `limit_markup_influence`
    - `metadata` optional

## ML Trigger

- `POST /api/ml/update-model`
- Placeholder endpoint to trigger retraining workflows

## Events

- `GET /api/events/topics`
- `POST /api/events/ingest`
  - Body:
    - `topic` one of:
      - `search_events`
      - `booking_events`
      - `price_updates`
      - `competitor_data`
    - `listing_id`, `host_id`, `user_id` optional
    - `payload` object

## Experiments

- `GET /api/experiments/summary`
- `POST /api/experiments/outcome`
  - Body:
    - `user_id`
    - `listing_id`
    - `conversion` boolean
    - `revenue` number
