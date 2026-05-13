function createChaosMiddleware() {
  return async function chaosMiddleware(req, res, next) {
    const enabled = process.env.CHAOS_ENABLED === "true";
    if (!enabled) return next();

    const fault = String(req.headers["x-chaos-fault"] || "");
    if (fault === "latency") {
      const delayMs = Number(req.headers["x-chaos-delay-ms"] || 200);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(delayMs, 5000))));
      return next();
    }
    if (fault === "error") {
      return res.status(503).json({ error: "Injected chaos fault" });
    }
    return next();
  };
}

module.exports = {
  createChaosMiddleware
};
