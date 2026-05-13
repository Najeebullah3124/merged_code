const mongoose = require("mongoose");

const deadLetterEventSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true, index: true },
    listingId: { type: String, default: null, index: true },
    hostId: { type: String, default: null, index: true },
    userId: { type: String, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    attempts: { type: Number, required: true },
    lastError: { type: String, default: "unknown-error" },
    sourceQueueId: { type: String, required: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("DeadLetterEvent", deadLetterEventSchema);
