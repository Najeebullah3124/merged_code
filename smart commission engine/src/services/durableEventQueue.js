const logger = require("./logger");

class DurableEventQueue {
  constructor({
    QueuedEvent,
    DeadLetterEvent,
    featureStore,
    leaseMs = 30_000,
    pollIntervalMs = 1_000,
    maxAttempts = 5
  }) {
    this.QueuedEvent = QueuedEvent;
    this.DeadLetterEvent = DeadLetterEvent;
    this.featureStore = featureStore;
    this.leaseMs = leaseMs;
    this.pollIntervalMs = pollIntervalMs;
    this.maxAttempts = maxAttempts;
    this.timer = null;
    this.processing = false;
    this.metricsState = {
      claimedCount: 0,
      processedCount: 0,
      failedCount: 0,
      dlqCount: 0
    };
  }

  async enqueue(eventPayload) {
    await this.QueuedEvent.create({
      ...eventPayload,
      status: "pending",
      attempts: 0,
      availableAt: new Date()
    });
  }

  async claimOne() {
    const now = new Date();
    const leaseUntil = new Date(Date.now() + this.leaseMs);
    const doc = await this.QueuedEvent.findOneAndUpdate(
      {
        status: "pending",
        availableAt: { $lte: now },
        $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }]
      },
      {
        $set: { status: "processing", leaseUntil },
        $inc: { attempts: 1 }
      },
      {
        sort: { createdAt: 1 },
        new: true
      }
    ).lean();
    if (doc) this.metricsState.claimedCount += 1;
    return doc;
  }

  async processOne(doc) {
    try {
      this.featureStore.updateFromEvent(doc);
      await this.QueuedEvent.updateOne(
        { _id: doc._id },
        { $set: { status: "done", leaseUntil: null, lastError: null } }
      );
      this.metricsState.processedCount += 1;
    } catch (error) {
      const exhausted = doc.attempts >= this.maxAttempts;
      if (exhausted) {
        await this.DeadLetterEvent.create({
          topic: doc.topic,
          listingId: doc.listingId,
          hostId: doc.hostId,
          userId: doc.userId,
          payload: doc.payload,
          attempts: doc.attempts,
          lastError: error.message,
          sourceQueueId: String(doc._id)
        });
        await this.QueuedEvent.updateOne(
          { _id: doc._id },
          {
            $set: {
              status: "failed",
              leaseUntil: null,
              lastError: error.message
            }
          }
        );
        this.metricsState.dlqCount += 1;
      } else {
        await this.QueuedEvent.updateOne(
          { _id: doc._id },
          {
            $set: {
              status: "pending",
              leaseUntil: null,
              availableAt: new Date(Date.now() + 1000),
              lastError: error.message
            }
          }
        );
      }
      this.metricsState.failedCount += 1;
      logger.error("durable_event_processing_failed", { message: error.message });
    }
  }

  async processTick() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (true) {
        const doc = await this.claimOne();
        if (!doc) break;
        await this.processOne(doc);
      }
    } finally {
      this.processing = false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processTick().catch((error) => {
        logger.error("durable_event_tick_failed", { message: error.message });
      });
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async metrics() {
    const [pending, processing, failed, done, dlq] = await Promise.all([
      this.QueuedEvent.countDocuments({ status: "pending" }),
      this.QueuedEvent.countDocuments({ status: "processing" }),
      this.QueuedEvent.countDocuments({ status: "failed" }),
      this.QueuedEvent.countDocuments({ status: "done" }),
      this.DeadLetterEvent.countDocuments({})
    ]);

    return {
      ...this.metricsState,
      queue: { pending, processing, failed, done },
      dlqSize: dlq
    };
  }
}

module.exports = {
  DurableEventQueue
};
