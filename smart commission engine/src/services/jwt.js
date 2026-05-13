const crypto = require("crypto");
const INTROSPECTION_TIMEOUT_MS = Number(process.env.INTROSPECTION_TIMEOUT_MS || 2000);

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function verifyHs256Token(token, secret) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }
  const data = `${encodedHeader}.${encodedPayload}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (payload.exp && Math.floor(Date.now() / 1000) > Number(payload.exp)) {
    return null;
  }
  return payload;
}

async function introspectAccessToken(token) {
  const introspectionUrl = process.env.OIDC_INTROSPECTION_URL;
  if (!introspectionUrl) return null;

  const authHeader = (() => {
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    if (!clientId || !clientSecret) return undefined;
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  })();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTROSPECTION_TIMEOUT_MS);
  try {
    const response = await fetch(introspectionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(authHeader ? { Authorization: authHeader } : {})
      },
      signal: controller.signal,
      body: `token=${encodeURIComponent(token)}`
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body.active) return null;
    if (body.exp && Math.floor(Date.now() / 1000) > Number(body.exp)) return null;
    return body;
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  verifyHs256Token,
  introspectAccessToken
};
