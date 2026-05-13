const topicToFeature = {
  search_events: "demandScore",
  booking_events: "conversionProbability",
  competitor_data: "competitorGap"
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class FeatureStore {
  constructor() {
    this.byListing = new Map();
  }

  updateFromEvent(event) {
    const listingId = event.listingId;
    if (!listingId) return;
    const featureName = topicToFeature[event.topic];
    if (!featureName) return;

    const listingFeatures = this.byListing.get(listingId) || {};
    const rawValue = Number(event.payload?.value);
    if (!Number.isFinite(rawValue)) return;

    if (featureName === "competitorGap") {
      listingFeatures[featureName] = Number(clamp(rawValue, -1, 1).toFixed(4));
    } else {
      listingFeatures[featureName] = Number(clamp(rawValue, 0, 1).toFixed(4));
    }
    listingFeatures.lastUpdatedAt = new Date().toISOString();
    this.byListing.set(listingId, listingFeatures);
  }

  getByListingId(listingId) {
    return this.byListing.get(listingId) || null;
  }
}

module.exports = {
  FeatureStore
};
