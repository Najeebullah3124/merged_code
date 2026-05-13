const mongoose = require("mongoose");

const hostSchema = new mongoose.Schema(
  {
    hostId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "Unknown Host" },
    hostScore: { type: Number, default: 0.5, min: 0, max: 1 },
    acceptanceRate: { type: Number, default: 0.8, min: 0, max: 1 },
    cancellationRate: { type: Number, default: 0.05, min: 0, max: 1 },
    responseTimeMinutes: { type: Number, default: 10, min: 0 },
    autoPricingEnabled: { type: Boolean, default: true },
    subscriptionTier: { type: String, default: "standard", enum: ["standard", "premium"] },
    riskTolerance: { type: String, default: "balanced", enum: ["conservative", "balanced", "aggressive"] }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Host", hostSchema);
