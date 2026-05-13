module.exports = {
  staticMarkup: 0.1,
  fraudServiceUrl: process.env.FRAUD_SERVICE_URL || "http://127.0.0.1:8000/fraud-score",
  enableFraudService: process.env.ENABLE_FRAUD_SERVICE === "true"
};
