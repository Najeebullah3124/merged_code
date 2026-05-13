# Architecture

## Runtime Components

- `Node.js/Express API` for pricing, controls, experiments, and event ingestion
- `MongoDB` for persistent models and event history
- `Offline demo state` fallback for environments without MongoDB
- `Python fraud service` (optional) consumed by pricing route
- `Python simulation engine` for pricing strategy testing

## Main Data Models

- `Listing`
- `Host`
- `PricingEvent`
- `FraudEvent`
- `ABTestEvent`
- `StreamEvent`
- `AdminConfig`

## Pricing Request Flow

1. Resolve listing and host
2. Check admin manual override for listing
3. Resolve experiment variant
4. Build feature vector from request + host profile
5. Compute markup (static or dynamic)
6. Apply host risk tolerance and guardrails
7. Apply fraud guard behavior (if enabled)
8. Return explainable final price payload
9. Persist pricing/fraud/experiment telemetry

## Control Paths

- Host controls:
  - auto-pricing on/off
  - subscription tier
  - risk tolerance profile
- Admin controls:
  - markup limits
  - listing-level manual price override

## Event Streaming Compatibility

- Current API exposes topic ingest interface compatible with:
  - `search_events`
  - `booking_events`
  - `price_updates`
  - `competitor_data`
- Future production deployment can route these endpoints to Kafka/PubSub workers.
