const express = require("express");
const config = require("../config/markupConfig");
const runtimeConfig = require("../config/runtimeConfig");
const { calculateDynamicMarkup, buildPriceResponse } = require("../services/markupEngine");
const { pickVariant, getFraudGuard, applyRiskTolerance, getPriceOverride } = require("../services/pricingRuntime");

function createPricingRoutes(ctx) {
  const router = express.Router();
  const { demoState, featureStore, models } = ctx;
  const { Listing, Host, PricingEvent, FraudEvent, ABTestEvent, AdminConfig } = models;

  router.get("/listings", async (_req, res) => {
    try {
      if (demoState.offlineMode) return res.json(demoState.listings);
      const listings = await Listing.find({}, { _id: 0, __v: 0 }).lean();
      return res.json(listings);
    } catch (_error) {
      return res.status(500).json({ error: "Failed to fetch listings" });
    }
  });

  router.get("/pricing/:listingId", async (req, res) => {
    try {
      const listing = demoState.offlineMode
        ? demoState.listings.find((item) => item.listingId === req.params.listingId)
        : await Listing.findOne({ listingId: req.params.listingId }).lean();
      if (!listing) return res.status(404).json({ error: "Listing not found" });

      const host = demoState.offlineMode
        ? demoState.hosts.find((item) => item.hostId === listing.hostId)
        : await Host.findOne({ hostId: listing.hostId }).lean();

      const override = await getPriceOverride(listing.listingId, { demoState, AdminConfig });
      if (override) {
        const finalPrice = Number(override.finalPrice);
        const markup = Number((finalPrice / listing.basePrice - 1).toFixed(4));
        return res.json({
          base_price: listing.basePrice,
          markup,
          final_price: finalPrice,
          explanation: [override.reason || "Manual admin override is active"],
          mode: "admin_override",
          override
        });
      }

      if (!host?.autoPricingEnabled) {
        return res.json({
          base_price: listing.basePrice,
          markup: runtimeConfig.staticMarkup,
          final_price: Number((listing.basePrice * (1 + runtimeConfig.staticMarkup)).toFixed(2)),
          explanation: ["Auto-pricing is disabled for this host"],
          mode: "host_opt_out"
        });
      }

      const listingFeatures = featureStore.getByListingId(listing.listingId) || {};
      const userId = String(req.query.userId || "anonymous-user");
      const variant = String(req.query.variant || pickVariant(userId, listing.listingId));
      const features = {
        demandScore: Number(req.query.demandScore ?? listingFeatures.demandScore ?? 0.6),
        elasticityScore: Number(req.query.elasticityScore ?? 0),
        conversionProbability: Number(req.query.conversionProbability ?? listingFeatures.conversionProbability ?? 0.65),
        hostScore: Number(req.query.hostScore ?? host?.hostScore ?? 0.5),
        competitorGap: Number(req.query.competitorGap ?? listingFeatures.competitorGap ?? 0)
      };

      const previousEvent = demoState.offlineMode
        ? [...demoState.pricingEvents].reverse().find((event) => event.listingId === listing.listingId)
        : await PricingEvent.findOne({ listingId: listing.listingId }).sort({ createdAt: -1 }).lean();
      const previousMarkup = previousEvent?.markup ?? config.baseMarkup;

      let markup = variant === "control_static" ? runtimeConfig.staticMarkup : calculateDynamicMarkup(features, previousMarkup);
      markup = applyRiskTolerance(markup, host?.riskTolerance || "balanced");
      markup = Math.max(config.minMarkup, Math.min(config.maxMarkup, markup));

      const fraudGuard = await getFraudGuard(userId, listing.hostId, listing.listingId);
      if (fraudGuard.limitMarkupInfluence) {
        markup = Number(((markup + previousMarkup) / 2).toFixed(4));
      }

      const response = buildPriceResponse({ basePrice: listing.basePrice, markup, features });
      response.experiment = { key: "markup_strategy_v1", variant };
      response.fraud_guard = fraudGuard;

      if (demoState.offlineMode) {
        demoState.pricingEvents.push({
          listingId: listing.listingId,
          hostId: listing.hostId,
          basePrice: listing.basePrice,
          previousMarkup,
          markup,
          finalPrice: response.final_price,
          features,
          experimentVariant: variant,
          riskLevel: fraudGuard.riskLevel,
          createdAt: new Date()
        });
        demoState.fraudEvents.push({
          id: `fraud-${demoState.fraudEvents.length + 1}`,
          listingId: listing.listingId,
          hostId: listing.hostId,
          userId,
          eventType: "pricing_request",
          fraudScore: fraudGuard.riskLevel === "low" ? 0 : 0.5,
          riskLevel: fraudGuard.riskLevel,
          excludeFromTraining: fraudGuard.excludeFromTraining,
          limitMarkupInfluence: fraudGuard.limitMarkupInfluence,
          metadata: { source: "pricing-engine" },
          createdAt: new Date()
        });
        demoState.pricingEvents = demoState.pricingEvents.slice(-500);
        demoState.fraudEvents = demoState.fraudEvents.slice(-500);
      } else {
        await PricingEvent.create({
          listingId: listing.listingId,
          hostId: listing.hostId,
          basePrice: listing.basePrice,
          previousMarkup,
          markup,
          finalPrice: response.final_price,
          features,
          experimentVariant: variant,
          riskLevel: fraudGuard.riskLevel
        });
        await FraudEvent.create({
          listingId: listing.listingId,
          hostId: listing.hostId,
          userId,
          eventType: "pricing_request",
          fraudScore: fraudGuard.riskLevel === "low" ? 0 : 0.5,
          riskLevel: fraudGuard.riskLevel,
          excludeFromTraining: fraudGuard.excludeFromTraining,
          limitMarkupInfluence: fraudGuard.limitMarkupInfluence,
          metadata: { source: "pricing-engine" }
        });
        await ABTestEvent.create({
          userId,
          listingId: listing.listingId,
          experimentKey: "markup_strategy_v1",
          variant
        });
      }

      return res.json(response);
    } catch (_error) {
      return res.status(500).json({ error: "Failed to calculate dynamic pricing" });
    }
  });

  router.get("/host/pricing-insights/:hostId", async (req, res) => {
    try {
      const host = demoState.offlineMode
        ? demoState.hosts.find((item) => item.hostId === req.params.hostId)
        : await Host.findOne({ hostId: req.params.hostId }).lean();
      if (!host) return res.status(404).json({ error: "Host not found" });

      const recentPricingEvents = demoState.offlineMode
        ? demoState.pricingEvents.filter((event) => event.hostId === req.params.hostId).slice(-25).reverse()
        : await PricingEvent.find({ hostId: req.params.hostId }).sort({ createdAt: -1 }).limit(25).lean();
      const avgMarkup =
        recentPricingEvents.length > 0
          ? Number((recentPricingEvents.reduce((acc, event) => acc + event.markup, 0) / recentPricingEvents.length).toFixed(4))
          : null;

      return res.json({
        hostId: host.hostId,
        hostScore: host.hostScore,
        acceptanceRate: host.acceptanceRate,
        cancellationRate: host.cancellationRate,
        autoPricingEnabled: host.autoPricingEnabled,
        subscriptionTier: host.subscriptionTier,
        riskTolerance: host.riskTolerance || "balanced",
        avgMarkupLast25Events: avgMarkup
      });
    } catch (_error) {
      return res.status(500).json({ error: "Failed to get host pricing insights" });
    }
  });

  return router;
}

module.exports = {
  createPricingRoutes
};
