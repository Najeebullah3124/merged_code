function createDemoState() {
  return {
    offlineMode: false,
    listings: [
      { listingId: "listing-001", title: "Luxury Condo Miami", basePrice: 150, hostId: "host-123" },
      { listingId: "listing-002", title: "City Apartment", basePrice: 90, hostId: "host-456" }
    ],
    hosts: [
      {
        hostId: "host-123",
        name: "John Doe",
        hostScore: 0.91,
        acceptanceRate: 0.95,
        cancellationRate: 0.02,
        responseTimeMinutes: 4,
        autoPricingEnabled: true,
        subscriptionTier: "premium",
        riskTolerance: "balanced"
      },
      {
        hostId: "host-456",
        name: "Jane Smith",
        hostScore: 0.74,
        acceptanceRate: 0.89,
        cancellationRate: 0.05,
        responseTimeMinutes: 9,
        autoPricingEnabled: true,
        subscriptionTier: "standard",
        riskTolerance: "conservative"
      }
    ],
    pricingEvents: [],
    fraudEvents: [],
    adminConfig: null,
    priceOverrides: {},
    streamEvents: []
  };
}

module.exports = {
  createDemoState
};
