const BASE_URL = process.env.LOADTEST_BASE_URL || "http://127.0.0.1:3000";
const TOTAL_REQUESTS = Number(process.env.LOADTEST_TOTAL_REQUESTS || 120);
const CONCURRENCY = Number(process.env.LOADTEST_CONCURRENCY || 12);
const MAX_P95_MS = Number(process.env.LOADTEST_MAX_P95_MS || 600);
const MAX_ERROR_RATE = Number(process.env.LOADTEST_MAX_ERROR_RATE || 0.02);

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[idx];
}

async function hitPricing(index) {
  const started = Date.now();
  const listingId = index % 2 === 0 ? "listing-001" : "listing-002";
  const response = await fetch(`${BASE_URL}/api/pricing/${listingId}?variant=variant_ai`);
  const latencyMs = Date.now() - started;
  return { ok: response.ok, status: response.status, latencyMs };
}

async function run() {
  const inFlight = new Set();
  const results = [];
  let i = 0;

  while (i < TOTAL_REQUESTS || inFlight.size > 0) {
    while (i < TOTAL_REQUESTS && inFlight.size < CONCURRENCY) {
      const idx = i++;
      const task = hitPricing(idx)
        .then((result) => results.push(result))
        .catch(() => results.push({ ok: false, status: 0, latencyMs: 10_000 }))
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  const latencies = results.map((r) => r.latencyMs);
  const errors = results.filter((r) => !r.ok).length;
  const errorRate = errors / results.length;
  const p95Ms = percentile(latencies, 0.95);

  const summary = {
    baseUrl: BASE_URL,
    totalRequests: results.length,
    concurrency: CONCURRENCY,
    p50Ms: percentile(latencies, 0.5),
    p95Ms,
    maxMs: Math.max(...latencies),
    errorRate: Number(errorRate.toFixed(4)),
    errors
  };

  console.log(JSON.stringify(summary, null, 2));

  if (p95Ms > MAX_P95_MS || errorRate > MAX_ERROR_RATE) {
    console.error(
      `Load test failed thresholds: p95=${p95Ms}ms (max ${MAX_P95_MS}), errorRate=${errorRate.toFixed(4)} (max ${MAX_ERROR_RATE})`
    );
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("Load test crashed:", error.message);
  process.exit(1);
});
