const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createApp } = require("../src/app");
const { createDemoState } = require("../src/state/demoState");

function startTestServer() {
  const demoState = createDemoState();
  demoState.offlineMode = true;
  const { app } = createApp({ demoState });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function createAdminJwt(secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 60
    })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

test("GET /api/pricing/:listingId returns explainable response", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/pricing/listing-001`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.final_price, "number");
    assert.ok(Array.isArray(body.explanation));
    assert.ok(body.breakdown);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/events/ingest influences pricing features", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const ingest = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "ingest-1" },
      body: JSON.stringify({
        topic: "search_events",
        listing_id: "listing-001",
        payload: { value: 0.95 }
      })
    });
    assert.equal(ingest.status, 201);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const priced = await fetch(`${baseUrl}/api/pricing/listing-001?variant=variant_ai`);
    assert.equal(priced.status, 200);
    const body = await priced.json();
    assert.ok(body.breakdown.demand_adjustment >= 0.047);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/events/ingest rejects requests without idempotency key", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const ingest = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "search_events",
        listing_id: "listing-001",
        payload: { value: 0.95 }
      })
    });
    assert.equal(ingest.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST endpoints enforce application/json content type", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Idempotency-Key": "ctype-1" },
      body: "topic=search_events"
    });
    assert.equal(response.status, 415);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST endpoints reject prototype-poisoning keys", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "poison-1" },
      body: '{"topic":"search_events","listing_id":"listing-001","payload":{"__proto__":{"polluted":true}}}'
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/events/ingest returns deduplicated response for same idempotency key", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const payload = {
      topic: "search_events",
      listing_id: "listing-001",
      payload: { value: 0.65 }
    };
    const first = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "dup-1" },
      body: JSON.stringify(payload)
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "dup-1" },
      body: JSON.stringify(payload)
    });
    assert.equal(second.status, 201);
    const dedup = await second.json();
    assert.equal(dedup.duplicate, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/events/ingest rejects idempotency key reuse with different payload", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const first = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "dup-conflict" },
      body: JSON.stringify({
        topic: "search_events",
        listing_id: "listing-001",
        payload: { value: 0.61 }
      })
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/api/events/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "dup-conflict" },
      body: JSON.stringify({
        topic: "search_events",
        listing_id: "listing-001",
        payload: { value: 0.93 }
      })
    });
    assert.equal(second.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CORS denies disallowed origins when ALLOWED_ORIGINS is set", async () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://allowed.example";
  const { server, baseUrl } = await startTestServer();
  try {
    const denied = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://evil.example" }
    });
    assert.equal(denied.status, 403);
  } finally {
    process.env.ALLOWED_ORIGINS = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /metrics returns route-level p95 and error rates", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    await fetch(`${baseUrl}/api/pricing/listing-001`);
    const metricsRes = await fetch(`${baseUrl}/metrics`);
    assert.equal(metricsRes.status, 200);
    const metrics = await metricsRes.json();
    assert.ok(metrics.generatedAt);
    assert.equal(typeof metrics.routes, "object");
    const routeValues = Object.values(metrics.routes);
    assert.ok(routeValues.some((r) => typeof r.p95Ms === "number"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /metrics/prometheus returns text exposition", async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    await fetch(`${baseUrl}/api/pricing/listing-001`);
    const metricsRes = await fetch(`${baseUrl}/metrics/prometheus`);
    assert.equal(metricsRes.status, 200);
    const text = await metricsRes.text();
    assert.ok(text.includes("smart_commission_route_requests_total"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("chaos middleware injects error when enabled", async () => {
  const previous = process.env.CHAOS_ENABLED;
  process.env.CHAOS_ENABLED = "true";
  const { server, baseUrl } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/api/pricing/listing-001`, {
      headers: { "x-chaos-fault": "error" }
    });
    assert.equal(response.status, 503);
  } finally {
    process.env.CHAOS_ENABLED = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin endpoints require api key when configured", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "top-secret";
  const { server, baseUrl } = await startTestServer();
  try {
    const unauthorized = await fetch(`${baseUrl}/api/admin/markup-limits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ min_markup: 0.06, max_markup: 0.22 })
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/admin/markup-limits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-api-key": "top-secret" },
      body: JSON.stringify({ min_markup: 0.06, max_markup: 0.22 })
    });
    assert.equal(authorized.status, 200);
  } finally {
    process.env.ADMIN_API_KEY = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin endpoints allow valid admin JWT", async () => {
  const previousSecret = process.env.ADMIN_JWT_SECRET;
  const previousKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_JWT_SECRET = "jwt-secret";
  process.env.ADMIN_API_KEY = "";
  const token = createAdminJwt("jwt-secret");
  const { server, baseUrl } = await startTestServer();
  try {
    const authorized = await fetch(`${baseUrl}/api/admin/markup-limits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ min_markup: 0.06, max_markup: 0.22 })
    });
    assert.equal(authorized.status, 200);
  } finally {
    process.env.ADMIN_JWT_SECRET = previousSecret;
    process.env.ADMIN_API_KEY = previousKey;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("admin endpoints have stricter rate limiting", async () => {
  const previousKey = process.env.ADMIN_API_KEY;
  const previousWindow = process.env.ADMIN_RATE_LIMIT_WINDOW_MS;
  const previousMax = process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS;
  process.env.ADMIN_API_KEY = "rate-key";
  process.env.ADMIN_RATE_LIMIT_WINDOW_MS = "60000";
  process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS = "2";
  const { server, baseUrl } = await startTestServer();
  try {
    for (let i = 0; i < 2; i += 1) {
      const ok = await fetch(`${baseUrl}/api/admin/markup-limits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-api-key": "rate-key" },
        body: JSON.stringify({ min_markup: 0.06, max_markup: 0.22 })
      });
      assert.equal(ok.status, 200);
    }
    const blocked = await fetch(`${baseUrl}/api/admin/markup-limits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-api-key": "rate-key" },
      body: JSON.stringify({ min_markup: 0.06, max_markup: 0.22 })
    });
    assert.equal(blocked.status, 429);
  } finally {
    process.env.ADMIN_API_KEY = previousKey;
    process.env.ADMIN_RATE_LIMIT_WINDOW_MS = previousWindow;
    process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS = previousMax;
    await new Promise((resolve) => server.close(resolve));
  }
});
