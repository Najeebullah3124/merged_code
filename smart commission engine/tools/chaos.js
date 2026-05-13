const BASE_URL = process.env.CHAOS_BASE_URL || "http://127.0.0.1:3000";

async function run() {
  const healthy = await fetch(`${BASE_URL}/health`);
  if (!healthy.ok) {
    throw new Error(`Health failed before chaos: ${healthy.status}`);
  }

  const latencyStart = Date.now();
  const latencyRes = await fetch(`${BASE_URL}/api/pricing/listing-001`, {
    headers: {
      "x-chaos-fault": "latency",
      "x-chaos-delay-ms": "300"
    }
  });
  const latencyMs = Date.now() - latencyStart;
  if (!latencyRes.ok) throw new Error(`Latency scenario failed: ${latencyRes.status}`);
  if (latencyMs < 250) throw new Error(`Latency injection too low: ${latencyMs}ms`);

  const errorRes = await fetch(`${BASE_URL}/api/pricing/listing-001`, {
    headers: { "x-chaos-fault": "error" }
  });
  if (errorRes.status !== 503) {
    throw new Error(`Error injection expected 503, got ${errorRes.status}`);
  }

  const postHealthy = await fetch(`${BASE_URL}/health`);
  if (!postHealthy.ok) {
    throw new Error(`Health failed after chaos: ${postHealthy.status}`);
  }

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        latencyMs,
        injectedErrorStatus: errorRes.status,
        status: "chaos_passed"
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error("Chaos test failed:", error.message);
  process.exit(1);
});
