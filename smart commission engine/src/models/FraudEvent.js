const mongoose = require("mongoose");

const fraudEventSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, index: true },
    hostId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    fraudScore: { type: Number, required: true, min: 0, max: 1 },
    riskLevel: { type: String, required: true, enum: ["low", "medium", "high", "critical"] },
    excludeFromTraining: { type: Boolean, default: false },
    limitMarkupInfluence: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model("FraudEvent", fraudEventSchema);
