function createMetricsCollector() {
  const routeStats = new Map();

  function getRouteKey(req) {
    const routePath = req.route?.path || req.path || "unknown";
    return `${req.method} ${routePath}`;
  }

  function middleware(req, res, next) {
    const startedAt = Date.now();
    res.on("finish", () => {
      const key = getRouteKey(req);
      const durationMs = Date.now() - startedAt;
      const stat = routeStats.get(key) || { count: 0, errors: 0, durations: [] };
      stat.count += 1;
      if (res.statusCode >= 500) stat.errors += 1;
      stat.durations.push(durationMs);
      if (stat.durations.length > 500) stat.durations.shift();
      routeStats.set(key, stat);
    });
    next();
  }

  function p95(durations) {
    if (!durations.length) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[idx];
  }

  function snapshot() {
    const routes = {};
    for (const [key, stat] of routeStats.entries()) {
      routes[key] = {
        requests: stat.count,
        errors5xx: stat.errors,
        errorRate: stat.count > 0 ? Number((stat.errors / stat.count).toFixed(4)) : 0,
        p95Ms: p95(stat.durations)
      };
    }
    return {
      generatedAt: new Date().toISOString(),
      routes
    };
  }

  function prometheus() {
    const lines = [];
    lines.push("# HELP smart_commission_route_requests_total Total requests per route");
    lines.push("# TYPE smart_commission_route_requests_total counter");
    lines.push("# HELP smart_commission_route_errors_total Total 5xx errors per route");
    lines.push("# TYPE smart_commission_route_errors_total counter");
    lines.push("# HELP smart_commission_route_p95_ms Route p95 latency in milliseconds");
    lines.push("# TYPE smart_commission_route_p95_ms gauge");
    lines.push("# HELP smart_commission_route_error_rate Route 5xx error rate");
    lines.push("# TYPE smart_commission_route_error_rate gauge");

    for (const [route, stat] of routeStats.entries()) {
      const label = route.replace(/"/g, '\\"');
      lines.push(`smart_commission_route_requests_total{route="${label}"} ${stat.count}`);
      lines.push(`smart_commission_route_errors_total{route="${label}"} ${stat.errors}`);
      lines.push(`smart_commission_route_p95_ms{route="${label}"} ${p95(stat.durations)}`);
      const rate = stat.count > 0 ? stat.errors / stat.count : 0;
      lines.push(`smart_commission_route_error_rate{route="${label}"} ${rate.toFixed(6)}`);
    }
    return `${lines.join("\n")}\n`;
  }

  return { middleware, snapshot, prometheus };
}

module.exports = {
  createMetricsCollector
};
