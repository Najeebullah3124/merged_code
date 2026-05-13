const { timingSafeEqual } = require("crypto");
const { verifyHs256Token, introspectAccessToken } = require("../services/jwt");
const { hasPermission } = require("./rbac");

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'self'");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

function corsGuard(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next();

  const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Admin-Api-Key, X-Request-Id");
  if (req.method === "OPTIONS") {
    return res.status(204).send();
  }
  return next();
}

function requireAdminApiKey(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey) return next();
  const receivedKey = String(req.headers["x-admin-api-key"] || "");
  const configuredBuffer = Buffer.from(configuredKey);
  const receivedBuffer = Buffer.from(receivedKey);
  const isMatch =
    configuredBuffer.length === receivedBuffer.length && timingSafeEqual(configuredBuffer, receivedBuffer);
  if (!isMatch) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

async function resolveAccessClaims(req) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;

  const introspected = await introspectAccessToken(token);
  if (introspected) return introspected;

  const jwtSecret = process.env.ADMIN_JWT_SECRET;
  if (jwtSecret) {
    return verifyHs256Token(token, jwtSecret);
  }
  return null;
}

function requirePermission(permission) {
  return async function permissionMiddleware(req, res, next) {
    const claims = await resolveAccessClaims(req);
    if (claims && hasPermission(claims, permission)) {
      req.authClaims = claims;
      return next();
    }
    return requireAdminApiKey(req, res, next);
  };
}

module.exports = {
  securityHeaders,
  corsGuard,
  requireAdminApiKey,
  requirePermission
};
