// src/tests/testGenerateDepositAddress.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { getOrCreateDepositAddress } from "../bot/handlers/generateDepositAddress.js";
import { logger } from "../utils/logger.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// ──────────────────────────────────────────────
// 🩺 Health check route
// ──────────────────────────────────────────────
app.get("/", (_, res) => {
  res.send(`
    <h2>🧪 TRC20 Deposit Address Test Server</h2>
    <p>POST <code>/api/deposit-address</code> with JSON body:</p>
    <pre>{ "telegram_id": 5171349113 }</pre>
    <p>Example:</p>
    <code>
      curl -X POST http://localhost:${process.env.PORT || 4000}/api/deposit-address ^
      -H "Content-Type: application/json" ^
      -d "{ \\"telegram_id\\": 5171349113 }"
    </code>
  `);
});

// ──────────────────────────────────────────────
// 🧩 Main API: Generate / Fetch TRC20 Deposit Address
// ──────────────────────────────────────────────
app.post("/api/deposit-address", async (req, res) => {
  const { telegram_id } = req.body;

  if (!telegram_id) {
    logger.warn("⚠️ Missing 'telegram_id' in request body.");
    return res.status(400).json({ error: "telegram_id required" });
  }

  try {
    logger.info(`📩 [API] Generating deposit address for user ${telegram_id}...`);

    // Call main wallet derivation logic
    const address = await getOrCreateDepositAddress(telegram_id);

    logger.info(`✅ [API] TRC20 deposit address generated for ${telegram_id}: ${address}`);

    res.json({
      telegram_id,
      deposit_address: address,
      message: "TRC20 deposit address generated successfully",
    });
  } catch (err) {
    logger.error(`❌ [API] Failed to generate address for ${telegram_id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// 🧯 Global error safety
// ──────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.error(`💥 Unhandled Promise Rejection: ${reason}`);
});
process.on("uncaughtException", (err) => {
  logger.error(`💥 Uncaught Exception: ${err.message}`);
});

// ──────────────────────────────────────────────
// 🚀 Start Express test server
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`🚀 Test server running at http://localhost:${PORT}`);
  logger.info("💡 Send a POST to /api/deposit-address with a Telegram ID to test derivation.");
});
