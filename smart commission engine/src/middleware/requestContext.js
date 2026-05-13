const { randomUUID } = require("crypto");
const logger = require("../services/logger");

function requestContext(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  const start = Date.now();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    logger.info("http_request", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start
    });
  });

  next();
}

module.exports = {
  requestContext
};
