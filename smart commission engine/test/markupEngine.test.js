const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config/markupConfig");
const { calculateDynamicMarkup, buildPriceResponse } = require("../src/services/markupEngine");

test("calculateDynamicMarkup respects configured min/max guardrails", () => {
  const high = calculateDynamicMarkup(
    {
      demandScore: 1,
      elasticityScore: -5,
      conversionProbability: 0,
      hostScore: 0,
      competitorGap: 1
    },
    0.19
  );
  assert.ok(high <= config.maxMarkup);

  const low = calculateDynamicMarkup(
    {
      demandScore: 0,
      elasticityScore: 5,
      conversionProbability: 1,
      hostScore: 1,
      competitorGap: -1
    },
    0.06
  );
  assert.ok(low >= config.minMarkup);
});

test("buildPriceResponse includes explainability fields", () => {
  const result = buildPriceResponse({
    basePrice: 100,
    markup: 0.12,
    features: {
      demandScore: 0.9,
      elasticityScore: -0.5,
      conversionProbability: 0.6,
      hostScore: 0.85,
      competitorGap: 0.2
    }
  });

  assert.equal(result.final_price, 112);
  assert.ok(Array.isArray(result.explanation));
  assert.ok(result.breakdown);
  assert.ok(result.fee_range_preview);
  assert.equal(typeof result.optimization_tip, "string");
});
