# Blueprint Coverage

This document maps `Smart Commission Engine.docx` requirements to the current implementation.

## Fully Implemented

- Dynamic markup pricing engine with formula-based adjustments
- Markup guardrails (`min`, `max`, daily jump limiter)
- Explainable response with reasons, breakdown, and fee range preview
- Host insights endpoint
- Admin markup limit controls
- Host auto-pricing opt-out behavior
- Host risk tolerance control (`conservative`, `balanced`, `aggressive`)
- Manual admin override per listing
- A/B strategy assignment (`control_static` vs `variant_ai`)
- A/B event capture and summary endpoint
- Fraud event persistence endpoint
- Optional live fraud service call in pricing path
- Offline fallback mode when MongoDB is unreachable

## Partially Implemented

- Real-time processing:
  - Implemented via request-time calculation and event ingest endpoint
  - Missing queue workers and scheduled recalibration jobs
- Event streaming:
  - Topic contract and ingest endpoint are implemented
  - Missing Kafka/PubSub broker integration and consumers
- Host dashboard:
  - Basic browser demo is implemented
  - Missing full analytics visuals and advanced control panel UX
- Security/compliance:
  - Audit-style persistence exists (pricing/fraud/event logs)
  - Missing auth/rate limiting/GDPR workflow endpoints

## Planned / Not Yet Implemented

- Feature store integration (Feast/Redis/BigQuery)
- ML prediction microservices for demand/conversion/elasticity inference
- Reinforcement learning optimizer
- Competitor intelligence ingestion pipeline and benchmarking service
- Simulation replay against historical traffic
- Full investor-grade analytics dashboard (uplift significance, churn impact)
- Production deployment manifests (Docker Compose/Kubernetes charts)

## Suggested Build Order (From Blueprint)

1. Feature store + real data features
2. Demand + conversion model inference endpoints
3. Event worker pipeline (Kafka/PubSub consumers)
4. Simulation replay and strategy validation
5. Reinforcement learning policy loop
