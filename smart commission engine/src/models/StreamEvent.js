const mongoose = require("mongoose");

const streamEventSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true, index: true },
    listingId: { type: String, default: null, index: true },
    hostId: { type: String, default: null, index: true },
    userId: { type: String, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model("StreamEvent", streamEventSchema);
