function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  });
}

function info(message, meta) {
  console.log(formatLog("info", message, meta));
}

function warn(message, meta) {
  console.warn(formatLog("warn", message, meta));
}

function error(message, meta) {
  console.error(formatLog("error", message, meta));
}

module.exports = {
  info,
  warn,
  error
};
