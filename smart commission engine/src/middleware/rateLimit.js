function createMemoryRateLimiter({ windowMs, maxRequests }) {
  const buckets = new Map();
  let lastPruneAt = Date.now();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown-ip";
    const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now >= entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    buckets.set(key, entry);

    // Periodically prune stale entries to avoid unbounded memory growth.
    if (now - lastPruneAt > windowMs) {
      for (const [bucketKey, bucketEntry] of buckets.entries()) {
        if (bucketEntry.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      }
      lastPruneAt = now;
    }

    res.setHeader("x-ratelimit-limit", String(maxRequests));
    res.setHeader("x-ratelimit-remaining", String(Math.max(0, maxRequests - entry.count)));
    res.setHeader("x-ratelimit-reset", String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: "Too many requests" });
    }
    return next();
  };
}

module.exports = {
  createMemoryRateLimiter
};
