const mongoose = require("mongoose");

const queuedEventSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true, index: true },
    listingId: { type: String, default: null, index: true },
    hostId: { type: String, default: null, index: true },
    userId: { type: String, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "processing", "done", "failed"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: Date.now, index: true },
    leaseUntil: { type: Date, default: null, index: true },
    lastError: { type: String, default: null }
  },
  { timestamps: true }
);

queuedEventSchema.index({ status: 1, availableAt: 1, leaseUntil: 1 });

module.exports = mongoose.model("QueuedEvent", queuedEventSchema);
