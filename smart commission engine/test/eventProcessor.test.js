const test = require("node:test");
const assert = require("node:assert/strict");
const { FeatureStore } = require("../src/services/featureStore");
const { EventProcessor } = require("../src/services/eventProcessor");

test("event processor updates feature store asynchronously", async () => {
  const featureStore = new FeatureStore();
  const eventProcessor = new EventProcessor({ featureStore });

  eventProcessor.enqueue({
    topic: "search_events",
    listingId: "listing-001",
    payload: { value: 0.82 }
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const features = featureStore.getByListingId("listing-001");

  assert.ok(features);
  assert.equal(features.demandScore, 0.82);
  assert.equal(eventProcessor.metrics().processedCount, 1);
});
