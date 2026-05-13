const mongoose = require("mongoose");

async function connectToDatabase() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smart_commission_engine";
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000
  });
  return mongoose.connection;
}

module.exports = {
  connectToDatabase
};
