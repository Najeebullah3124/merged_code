function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function hasPoisonedKeys(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasPoisonedKeys(item));
  }

  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return true;
    }
    if (hasPoisonedKeys(value[key])) {
      return true;
    }
  }
  return false;
}

function rejectPoisonedJson(req, res, next) {
  if (!isPlainObject(req.body) && !Array.isArray(req.body)) {
    return next();
  }
  if (hasPoisonedKeys(req.body)) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }
  return next();
}

function requireJsonContentType(req, res, next) {
  const needsBody = req.method === "POST" || req.method === "PATCH" || req.method === "PUT";
  if (!needsBody) return next();
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" });
  }
  return next();
}

module.exports = {
  rejectPoisonedJson,
  requireJsonContentType
};
