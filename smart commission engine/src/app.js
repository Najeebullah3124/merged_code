const express = require("express");
const path = require("path");
const { requestContext } = require("./middleware/requestContext");
const { securityHeaders, corsGuard } = require("./middleware/security");
const { createMemoryRateLimiter } = require("./middleware/rateLimit");
const { createMetricsCollector } = require("./middleware/metrics");
const { rejectPoisonedJson, requireJsonContentType } = require("./middleware/inputSecurity");
const { createChaosMiddleware } = require("./middleware/chaos");
const { FeatureStore } = require("./services/featureStore");
const { EventProcessor } = require("./services/eventProcessor");
const { IdempotencyStore } = require("./services/idempotencyStore");
const { createDemoState } = require("./state/demoState");
const { createPricingRoutes } = require("./routes/pricingRoutes");
const { createAdminRoutes } = require("./routes/adminRoutes");
const { createEventRoutes } = require("./routes/eventRoutes");
const Listing = require("./models/Listing");
const Host = require("./models/Host");
const PricingEvent = require("./models/PricingEvent");
const FraudEvent = require("./models/FraudEvent");
const AdminConfig = require("./models/AdminConfig");
const ABTestEvent = require("./models/ABTestEvent");
const StreamEvent = require("./models/StreamEvent");
const QueuedEvent = require("./models/QueuedEvent");
const DeadLetterEvent = require("./models/DeadLetterEvent");

function createApp(options = {}) {
  const demoState = options.demoState || createDemoState();
  const featureStore = options.featureStore || new FeatureStore();
  const eventProcessor = options.eventProcessor || new EventProcessor({ featureStore });
  const idempotencyStore = options.idempotencyStore || new IdempotencyStore();
  const metricsCollector = options.metricsCollector || createMetricsCollector();

  const models = {
    Listing,
    Host,
    PricingEvent,
    FraudEvent,
    AdminConfig,
    ABTestEvent,
    StreamEvent,
    QueuedEvent,
    DeadLetterEvent
  };

  const ctx = {
    demoState,
    featureStore,
    eventProcessor,
    durableQueue: options.durableQueue || null,
    idempotencyStore,
    metricsCollector,
    models
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(requireJsonContentType);
  app.use(rejectPoisonedJson);
  app.use(createChaosMiddleware());
  app.use(securityHeaders);
  app.use(corsGuard);
  app.use(requestContext);
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.set("trust proxy", 1);

  const globalRateLimit = createMemoryRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120)
  });
  const adminRateLimit = createMemoryRateLimiter({
    windowMs: Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || 60_000),
    maxRequests: Number(process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS || 30)
  });
  app.use(globalRateLimit);
  app.use(metricsCollector.middleware);

  app.get("/health", async (_req, res) => {
    const durableQueueMetrics = ctx.durableQueue ? await ctx.durableQueue.metrics() : null;
    return res.json({
      status: "ok",
      mode: demoState.offlineMode ? "offline-demo" : "mongodb",
      eventProcessor: eventProcessor.metrics(),
      durableQueue: durableQueueMetrics
    });
  });
  app.get("/metrics", (_req, res) => {
    return res.json(metricsCollector.snapshot());
  });
  app.get("/metrics/prometheus", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    return res.send(metricsCollector.prometheus());
  });

  app.use("/api", createPricingRoutes(ctx));
  app.use("/api/admin", adminRateLimit);
  app.use("/api/fraud", adminRateLimit);
  app.use("/api", createAdminRoutes(ctx));
  app.use("/api", createEventRoutes(ctx));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return { app, ctx };
}

module.exports = {
  createApp
};
