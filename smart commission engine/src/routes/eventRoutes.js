const express = require("express");

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function createEventRoutes(ctx) {
  const router = express.Router();
  const { demoState, eventProcessor, durableQueue, idempotencyStore, models } = ctx;
  const { StreamEvent, ABTestEvent } = models;

  router.get("/events/topics", (_req, res) => {
    return res.json(["search_events", "booking_events", "price_updates", "competitor_data"]);
  });

  router.post("/events/ingest", async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey || typeof idempotencyKey !== "string") {
      return res.status(400).json({ error: "Idempotency-Key header is required" });
    }
    if (idempotencyKey.length > 128) {
      return res.status(400).json({ error: "Idempotency-Key must be <= 128 chars" });
    }
    const requestFingerprint = stableStringify(req.body || {});
    const cached = idempotencyStore.get(`ingest:${idempotencyKey}`);
    if (cached) {
      if (cached.requestFingerprint && cached.requestFingerprint !== requestFingerprint) {
        return res.status(409).json({
          error: "Idempotency-Key already used with a different payload"
        });
      }
      return res.status(cached.statusCode).json({ ...cached.body, duplicate: true });
    }

    const topic = String(req.body.topic || "");
    const allowed = new Set(["search_events", "booking_events", "price_updates", "competitor_data"]);
    if (!allowed.has(topic)) return res.status(400).json({ error: "Invalid topic" });

    const eventPayload = {
      topic,
      listingId: req.body.listing_id ? String(req.body.listing_id) : null,
      hostId: req.body.host_id ? String(req.body.host_id) : null,
      userId: req.body.user_id ? String(req.body.user_id) : null,
      payload: req.body.payload || {}
    };
    if (eventPayload.payload && typeof eventPayload.payload !== "object") {
      return res.status(400).json({ error: "payload must be an object" });
    }

    try {
      if (demoState.offlineMode) {
        eventProcessor.enqueue(eventPayload);
        demoState.streamEvents.push({ ...eventPayload, createdAt: new Date() });
        demoState.streamEvents = demoState.streamEvents.slice(-1000);
        const body = { status: "ingested", mode: "offline-demo" };
        idempotencyStore.set(`ingest:${idempotencyKey}`, { statusCode: 201, body, requestFingerprint });
        return res.status(201).json(body);
      }
      if (durableQueue) {
        await durableQueue.enqueue(eventPayload);
      } else {
        eventProcessor.enqueue(eventPayload);
      }
      await StreamEvent.create(eventPayload);
      const body = { status: "ingested" };
      idempotencyStore.set(`ingest:${idempotencyKey}`, { statusCode: 201, body, requestFingerprint });
      return res.status(201).json(body);
    } catch (_error) {
      return res.status(500).json({ error: "Failed to ingest event" });
    }
  });

  router.get("/experiments/summary", async (_req, res) => {
    try {
      if (demoState.offlineMode) {
        const total = demoState.pricingEvents.length;
        const control = demoState.pricingEvents.filter((e) => e.experimentVariant === "control_static").length;
        const variant = total - control;
        return res.json({ experiment: "markup_strategy_v1", total, control_static: control, variant_ai: variant });
      }
      const docs = await ABTestEvent.aggregate([
        { $match: { experimentKey: "markup_strategy_v1" } },
        { $group: { _id: "$variant", count: { $sum: 1 } } }
      ]);
      const summary = docs.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {});
      return res.json({
        experiment: "markup_strategy_v1",
        total: (summary.control_static || 0) + (summary.variant_ai || 0),
        control_static: summary.control_static || 0,
        variant_ai: summary.variant_ai || 0
      });
    } catch (_error) {
      return res.status(500).json({ error: "Failed to fetch experiment summary" });
    }
  });

  router.post("/experiments/outcome", async (req, res) => {
    const userId = String(req.body.user_id || "");
    const listingId = String(req.body.listing_id || "");
    const conversion = Boolean(req.body.conversion);
    const revenue = Number(req.body.revenue);
    if (!userId || !listingId || !Number.isFinite(revenue)) {
      return res.status(400).json({ error: "user_id, listing_id, and revenue are required" });
    }

    try {
      if (demoState.offlineMode) return res.status(201).json({ status: "recorded", mode: "offline-demo" });
      await ABTestEvent.findOneAndUpdate(
        { userId, listingId, experimentKey: "markup_strategy_v1" },
        { conversion, revenue },
        { sort: { createdAt: -1 } }
      );
      return res.status(201).json({ status: "recorded" });
    } catch (_error) {
      return res.status(500).json({ error: "Failed to persist experiment outcome" });
    }
  });

  return router;
}

module.exports = {
  createEventRoutes
};
