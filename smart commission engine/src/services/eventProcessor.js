const logger = require("./logger");

class EventProcessor {
  constructor({ featureStore, maxRetries = 3 }) {
    this.queue = [];
    this.processing = false;
    this.featureStore = featureStore;
    this.processedCount = 0;
    this.failedCount = 0;
    this.retriedCount = 0;
    this.maxRetries = maxRetries;
  }

  enqueue(event) {
    this.queue.push({ event, attempts: 0 });
    this.processNext();
  }

  processNext() {
    if (this.processing) return;
    this.processing = true;

    setImmediate(() => {
      try {
        while (this.queue.length > 0) {
          const item = this.queue.shift();
          try {
            this.featureStore.updateFromEvent(item.event);
            this.processedCount += 1;
          } catch (error) {
            item.attempts += 1;
            if (item.attempts <= this.maxRetries) {
              this.retriedCount += 1;
              this.queue.push(item);
            } else {
              this.failedCount += 1;
              logger.error("event_processing_failed", { error: error.message });
            }
          }
        }
      } finally {
        this.processing = false;
      }
    });
  }

  metrics() {
    return {
      queueDepth: this.queue.length,
      processedCount: this.processedCount,
      failedCount: this.failedCount,
      retriedCount: this.retriedCount
    };
  }
}

module.exports = {
  EventProcessor
};
