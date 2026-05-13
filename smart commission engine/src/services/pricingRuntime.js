const runtimeConfig = require("../config/runtimeConfig");
const FRAUD_TIMEOUT_MS = Number(process.env.FRAUD_TIMEOUT_MS || 1500);

function hashToBucket(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  }
  return hash % 100;
}

function pickVariant(userId, listingId) {
  const bucket = hashToBucket(`${userId}:${listingId}:markup_strategy_v1`);
  return bucket < 50 ? "control_static" : "variant_ai";
}

async function getFraudGuard(userId, hostId, listingId) {
  if (!runtimeConfig.enableFraudService) {
    return { riskLevel: "low", limitMarkupInfluence: false, excludeFromTraining: false };
  }

  try {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), FRAUD_TIMEOUT_MS);
    try {
      const response = await fetch(runtimeConfig.fraudServiceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          event_type: "pricing_request",
          user_id: userId,
          host_id: hostId,
          listing_id: listingId,
          history: {}
        })
      })
      if (!response.ok) {
        return { riskLevel: "low", limitMarkupInfluence: false, excludeFromTraining: false };
      }
      const data = await response.json();
      return {
        riskLevel: data.risk_level || "low",
        limitMarkupInfluence: Boolean(data.limit_markup_influence),
        excludeFromTraining: Boolean(data.exclude_from_training)
      };
    } finally {
      clearTimeout(timerId);
    }
  } catch (_error) {
    return { riskLevel: "low", limitMarkupInfluence: false, excludeFromTraining: false };
  }
}

function applyRiskTolerance(markup, riskTolerance) {
  if (riskTolerance === "conservative") {
    return Number((markup * 0.9).toFixed(4));
  }
  if (riskTolerance === "aggressive") {
    return Number((markup * 1.1).toFixed(4));
  }
  return markup;
}

async function getPriceOverride(listingId, { demoState, AdminConfig }) {
  if (demoState.offlineMode) {
    const override = demoState.priceOverrides[listingId];
    if (!override) return null;
    if (override.expiresAt && new Date(override.expiresAt).getTime() < Date.now()) return null;
    return override;
  }

  const doc = await AdminConfig.findOne({ key: "price_overrides" }).lean();
  const override = doc?.value?.[listingId];
  if (!override) return null;
  if (override.expiresAt && new Date(override.expiresAt).getTime() < Date.now()) return null;
  return override;
}

module.exports = {
  pickVariant,
  getFraudGuard,
  applyRiskTolerance,
  getPriceOverride
};
