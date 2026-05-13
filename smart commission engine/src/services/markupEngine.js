const config = require("../config/markupConfig");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function calculateDynamicMarkup(features, previousMarkup = config.baseMarkup) {
  const demandScore = safeNumber(features.demandScore);
  const elasticityScore = safeNumber(features.elasticityScore);
  const conversionProbability = clamp(safeNumber(features.conversionProbability), 0, 1);
  const hostScore = clamp(safeNumber(features.hostScore), 0, 1);
  const competitorGap = safeNumber(features.competitorGap);

  let markup = config.baseMarkup;
  markup += demandScore * 0.05;
  markup -= elasticityScore * 0.03;
  markup += (1 - conversionProbability) * 0.04;
  markup += competitorGap * 0.02;

  if (hostScore > 0.8) {
    markup -= 0.02;
  }

  markup = clamp(markup, config.minMarkup, config.maxMarkup);

  // Smooth daily changes so hosts do not see sudden fee shocks.
  const dailyUpperBound = previousMarkup + config.maxDailyJump;
  const dailyLowerBound = previousMarkup - config.maxDailyJump;
  markup = clamp(markup, dailyLowerBound, dailyUpperBound);
  markup = clamp(markup, config.minMarkup, config.maxMarkup);

  return Number(markup.toFixed(4));
}

function buildPriceResponse({ basePrice, markup, features }) {
  const finalPrice = Number((basePrice * (1 + markup)).toFixed(2));
  const explanation = [];
  const breakdown = {
    base_markup: Number(config.baseMarkup.toFixed(4)),
    demand_adjustment: Number((safeNumber(features.demandScore) * 0.05).toFixed(4)),
    elasticity_adjustment: Number((-safeNumber(features.elasticityScore) * 0.03).toFixed(4)),
    conversion_adjustment: Number(((1 - clamp(safeNumber(features.conversionProbability), 0, 1)) * 0.04).toFixed(4)),
    competition_adjustment: Number((safeNumber(features.competitorGap) * 0.02).toFixed(4)),
    host_reward_adjustment: clamp(safeNumber(features.hostScore), 0, 1) > 0.8 ? -0.02 : 0
  };

  if (safeNumber(features.demandScore) > 0.7) {
    explanation.push("High demand in your area");
  }
  if (safeNumber(features.competitorGap) < 0) {
    explanation.push("You are priced above nearby alternatives");
  } else if (safeNumber(features.competitorGap) > 0) {
    explanation.push("You remain competitive in your market");
  }
  if (safeNumber(features.hostScore) > 0.8) {
    explanation.push("Host performance reward applied");
  }
  if (explanation.length === 0) {
    explanation.push("Balanced optimization across demand and conversion");
  }

  return {
    base_price: basePrice,
    markup,
    final_price: finalPrice,
    explanation,
    fee_range_preview: {
      min: config.minMarkup,
      max: config.maxMarkup
    },
    breakdown,
    optimization_tip:
      finalPrice > basePrice * 1.15
        ? "Consider lowering final price by 3-5% to improve conversion probability."
        : "Current pricing is conversion-friendly for this demand profile."
  };
}

module.exports = {
  calculateDynamicMarkup,
  buildPriceResponse
};
