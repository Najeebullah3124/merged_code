const listingSelect = document.getElementById("listingSelect");
const demandScoreInput = document.getElementById("demandScore");
const elasticityScoreInput = document.getElementById("elasticityScore");
const conversionProbabilityInput = document.getElementById("conversionProbability");
const competitorGapInput = document.getElementById("competitorGap");
const userIdInput = document.getElementById("userId");
const variantInput = document.getElementById("variant");
const simulateBtn = document.getElementById("simulateBtn");

const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const basePriceEl = document.getElementById("basePrice");
const markupEl = document.getElementById("markup");
const finalPriceEl = document.getElementById("finalPrice");
const experimentVariantEl = document.getElementById("experimentVariant");
const fraudRiskEl = document.getElementById("fraudRisk");
const feeRangeEl = document.getElementById("feeRange");
const optimizationTipEl = document.getElementById("optimizationTip");
const explanationList = document.getElementById("explanationList");

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadListings() {
  setStatus("Loading listings...");
  const response = await fetch("/api/listings");
  if (!response.ok) {
    throw new Error("Failed to load listings");
  }
  const listings = await response.json();
  listingSelect.innerHTML = "";
  for (const listing of listings) {
    const option = document.createElement("option");
    option.value = listing.listingId;
    option.textContent = `${listing.title} (${listing.listingId})`;
    listingSelect.appendChild(option);
  }
  setStatus("Ready.");
}

async function simulatePricing() {
  const listingId = listingSelect.value;
  const query = new URLSearchParams({
    demandScore: demandScoreInput.value,
    elasticityScore: elasticityScoreInput.value,
    conversionProbability: conversionProbabilityInput.value,
    competitorGap: competitorGapInput.value,
    userId: userIdInput.value
  });
  if (variantInput.value) {
    query.set("variant", variantInput.value);
  }

  setStatus("Calculating dynamic price...");
  const response = await fetch(`/api/pricing/${encodeURIComponent(listingId)}?${query.toString()}`);
  if (!response.ok) {
    throw new Error("Pricing request failed");
  }
  const data = await response.json();

  basePriceEl.textContent = `$${Number(data.base_price).toFixed(2)}`;
  markupEl.textContent = `${(Number(data.markup) * 100).toFixed(2)}%`;
  finalPriceEl.textContent = `$${Number(data.final_price).toFixed(2)}`;
  experimentVariantEl.textContent = data.experiment?.variant || "-";
  fraudRiskEl.textContent = data.fraud_guard?.riskLevel || "low";
  feeRangeEl.textContent = `${((data.fee_range_preview?.min || 0) * 100).toFixed(0)}% - ${(
    (data.fee_range_preview?.max || 0) * 100
  ).toFixed(0)}%`;
  optimizationTipEl.textContent = data.optimization_tip || "-";

  explanationList.innerHTML = "";
  for (const reason of data.explanation || []) {
    const li = document.createElement("li");
    li.textContent = reason;
    explanationList.appendChild(li);
  }

  resultEl.classList.remove("hidden");
  setStatus("Pricing simulation completed.");
}

simulateBtn.addEventListener("click", async () => {
  try {
    await simulatePricing();
  } catch (error) {
    setStatus(error.message);
  }
});

loadListings().catch((error) => {
  setStatus(error.message);
});
