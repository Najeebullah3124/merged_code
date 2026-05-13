const config = require("./config/markupConfig");
const logger = require("./services/logger");
const { connectToDatabase } = require("./db/mongoose");
const mongoose = require("mongoose");
const { seedIfEmpty } = require("./db/seedData");
const { createApp } = require("./app");
const AdminConfig = require("./models/AdminConfig");
const { DurableEventQueue } = require("./services/durableEventQueue");
const QueuedEvent = require("./models/QueuedEvent");
const DeadLetterEvent = require("./models/DeadLetterEvent");
const { app, ctx } = createApp();
const { demoState, featureStore } = ctx;
let server;

const port = process.env.PORT || 3000;
connectToDatabase()
  .then(async () => {
    await seedIfEmpty();
    ctx.durableQueue = new DurableEventQueue({
      QueuedEvent,
      DeadLetterEvent,
      featureStore,
      leaseMs: Number(process.env.QUEUE_LEASE_MS || 30_000),
      pollIntervalMs: Number(process.env.QUEUE_POLL_MS || 1_000),
      maxAttempts: Number(process.env.QUEUE_MAX_ATTEMPTS || 5)
    });
    ctx.durableQueue.start();

    const markupLimitsConfig = await AdminConfig.findOne({ key: "markup_limits" }).lean();
    if (markupLimitsConfig?.value?.minMarkup != null && markupLimitsConfig?.value?.maxMarkup != null) {
      config.minMarkup = Number(markupLimitsConfig.value.minMarkup);
      config.maxMarkup = Number(markupLimitsConfig.value.maxMarkup);
    }

    server = app.listen(port, () => {
      logger.info("server_started", { port, mode: "mongodb" });
    });
  })
  .catch((error) => {
    demoState.offlineMode = true;
    logger.warn("database_connection_failed_offline_mode", { message: error.message });
    server = app.listen(port, () => {
      logger.info("server_started", { port, mode: "offline-demo" });
    });
  });

function gracefulShutdown(signal) {
  logger.info("shutdown_started", { signal });
  if (ctx.durableQueue) {
    ctx.durableQueue.stop();
  }
  mongoose.connection.close().catch(() => {});
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => {
    logger.info("shutdown_complete", { signal });
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("shutdown_forced_timeout", { signal });
    process.exit(1);
  }, 8000).unref();
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
