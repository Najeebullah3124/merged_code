const mongoose = require("mongoose");

const pricingEventSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, index: true },
    hostId: { type: String, required: true, index: true },
    basePrice: { type: Number, required: true },
    previousMarkup: { type: Number, required: true },
    markup: { type: Number, required: true },
    finalPrice: { type: Number, required: true },
    experimentVariant: { type: String, default: "variant_ai" },
    riskLevel: { type: String, default: "low" },
    features: {
      demandScore: { type: Number, default: 0 },
      elasticityScore: { type: Number, default: 0 },
      conversionProbability: { type: Number, default: 0 },
      hostScore: { type: Number, default: 0 },
      competitorGap: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PricingEvent", pricingEventSchema);
