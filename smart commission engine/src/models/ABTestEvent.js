const mongoose = require("mongoose");

const abTestEventSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    listingId: { type: String, required: true, index: true },
    experimentKey: { type: String, required: true, default: "markup_strategy_v1" },
    variant: { type: String, required: true, enum: ["control_static", "variant_ai"] },
    conversion: { type: Boolean, default: null },
    revenue: { type: Number, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ABTestEvent", abTestEventSchema);
