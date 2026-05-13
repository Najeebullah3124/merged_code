const express = require("express");
const config = require("../config/markupConfig");
const { requirePermission } = require("../middleware/security");

function createAdminRoutes(ctx) {
  const router = express.Router();
  const { demoState, models } = ctx;
  const { Host, FraudEvent, AdminConfig } = models;

  router.post("/admin/markup-limits", requirePermission("admin:write"), async (req, res) => {
    const min = Number(req.body.min_markup);
    const max = Number(req.body.max_markup);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 1 || min >= max) {
      return res.status(400).json({ error: "Invalid min/max markup values" });
    }

    try {
      config.minMarkup = min;
      config.maxMarkup = max;
      if (demoState.offlineMode) {
        demoState.adminConfig = { key: "markup_limits", value: { minMarkup: min, maxMarkup: max } };
      } else {
        await AdminConfig.findOneAndUpdate(
          { key: "markup_limits" },
          { value: { minMarkup: min, maxMarkup: max } },
          { upsert: true, new: true }
        );
      }
      return res.json({ minMarkup: config.minMarkup, maxMarkup: config.maxMarkup });
    } catch (_error) {
      return res.status(500).json({ error: "Failed to persist markup limits" });
    }
  });

  router.post("/admin/price-override", requirePermission("admin:write"), async (req, res) => {
    const listingId = String(req.body.listing_id || "");
    const finalPrice = Number(req.body.final_price);
    const reason = String(req.body.reason || "Manual admin override");
    const expiresAt = req.body.expires_at ? new Date(req.body.expires_at).toISOString() : null;
    if (!listingId || !Number.isFinite(finalPrice) || finalPrice <= 0) {
      return res.status(400).json({ error: "listing_id and positive final_price are required" });
    }

    try {
      const override = { finalPrice, reason, expiresAt };
      if (demoState.offlineMode) {
        demoState.priceOverrides[listingId] = override;
        return res.status(201).json({ listingId, ...override, mode: "offline-demo" });
      }
      const current = (await AdminConfig.findOne({ key: "price_overrides" }).lean())?.value || {};
      current[listingId] = override;
      await AdminConfig.findOneAndUpdate({ key: "price_overrides" }, { value: current }, { upsert: true });
      return res.status(201).json({ listingId, ...override });
    } catch (_error) {
      return res.status(500).json({ error: "Failed to persist price override" });
    }
  });

  router.patch("/host/control/:hostId", requirePermission("host:write"), async (req, res) => {
    const hostId = req.params.hostId;
    const allowedRisk = ["conservative", "balanced", "aggressive"];
    const patch = {};
    if (typeof req.body.auto_pricing_enabled === "boolean") patch.autoPricingEnabled = req.body.auto_pricing_enabled;
    if (typeof req.body.subscription_tier === "string" && ["standard", "premium"].includes(req.body.subscription_tier)) {
      patch.subscriptionTier = req.body.subscription_tier;
    }
    if (typeof req.body.risk_tolerance === "string" && allowedRisk.includes(req.body.risk_tolerance)) {
      patch.riskTolerance = req.body.risk_tolerance;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid control fields provided" });

    try {
      if (demoState.offlineMode) {
        const host = demoState.hosts.find((item) => item.hostId === hostId);
        if (!host) return res.status(404).json({ error: "Host not found" });
        Object.assign(host, patch);
        return res.json(host);
      }
      const host = await Host.findOneAndUpdate({ hostId }, patch, { new: true }).lean();
      if (!host) return res.status(404).json({ error: "Host not found" });
      return res.json(host);
    } catch (_error) {
      return res.status(500).json({ error: "Failed to update host controls" });
    }
  });

  router.post("/fraud/events", requirePermission("fraud:write"), async (req, res) => {
    const fraudScore = Number(req.body.fraud_score);
    const riskLevel = String(req.body.risk_level || "low");
    if (!Number.isFinite(fraudScore) || fraudScore < 0 || fraudScore > 1) {
      return res.status(400).json({ error: "Invalid fraud_score" });
    }
    if (!["low", "medium", "high", "critical"].includes(riskLevel)) {
      return res.status(400).json({ error: "Invalid risk_level" });
    }

    try {
      if (demoState.offlineMode) {
        const id = `fraud-${demoState.fraudEvents.length + 1}`;
        demoState.fraudEvents.push({
          id,
          listingId: String(req.body.listing_id || ""),
          hostId: String(req.body.host_id || ""),
          userId: String(req.body.user_id || ""),
          eventType: String(req.body.event_type || "unknown"),
          fraudScore,
          riskLevel,
          excludeFromTraining: Boolean(req.body.exclude_from_training),
          limitMarkupInfluence: Boolean(req.body.limit_markup_influence),
          metadata: req.body.metadata || {},
          createdAt: new Date()
        });
        return res.status(201).json({ id });
      }
      const event = await FraudEvent.create({
        listingId: String(req.body.listing_id || ""),
        hostId: String(req.body.host_id || ""),
        userId: String(req.body.user_id || ""),
        eventType: String(req.body.event_type || "unknown"),
        fraudScore,
        riskLevel,
        excludeFromTraining: Boolean(req.body.exclude_from_training),
        limitMarkupInfluence: Boolean(req.body.limit_markup_influence),
        metadata: req.body.metadata || {}
      });
      return res.status(201).json({ id: event._id.toString() });
    } catch (_error) {
      return res.status(500).json({ error: "Failed to persist fraud event" });
    }
  });

  router.post("/ml/update-model", (_req, res) => {
    return res.json({
      status: "accepted",
      message: "Model update trigger accepted. Connect this endpoint to your retraining pipeline."
    });
  });

  return router;
}

module.exports = {
  createAdminRoutes
};
