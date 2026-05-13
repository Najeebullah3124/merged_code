const Listing = require("../models/Listing");
const Host = require("../models/Host");

async function seedIfEmpty() {
  const listingCount = await Listing.countDocuments();
  const hostCount = await Host.countDocuments();

  if (hostCount === 0) {
    await Host.insertMany([
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
    ]);
  }

  if (listingCount === 0) {
    await Listing.insertMany([
      { listingId: "listing-001", title: "Luxury Condo Miami", basePrice: 150, hostId: "host-123", category: "hotel", locationCity: "Miami" },
      { listingId: "listing-002", title: "City Apartment", basePrice: 90, hostId: "host-456", category: "hotel", locationCity: "Austin" }
    ]);
  }
}

module.exports = {
  seedIfEmpty
};
