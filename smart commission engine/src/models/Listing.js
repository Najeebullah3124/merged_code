const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    basePrice: { type: Number, required: true, min: 0 },
    hostId: { type: String, required: true, index: true },
    category: { type: String, default: "hotel" },
    locationCity: { type: String, default: "Unknown" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Listing", listingSchema);
