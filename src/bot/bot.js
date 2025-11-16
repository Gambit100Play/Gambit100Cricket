// =====================================================
// 🤖 TELEGRAM BOT — SINGLE ENTRY POINT (Redis + Stable Production v3.5)
// =====================================================
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import LocalSession from "telegraf-session-local";
import { logger } from "../utils/logger.js";

// =====================================================
// 🔧 Load environment
// =====================================================
dotenv.config();
const token = process.env.BOT_TOKEN;
if (!token) {
  logger.error("❌ BOT_TOKEN missing in .env file");
  process.exit(1);
}

// =====================================================
// 🔥 Load Redis (global persistent cache/locks/rate-limits)
// =====================================================
import "../redis/index.js"; 
// This automatically connects Redis.
// It exports a shared global instance via: import { redis } from "../redis/index.js";

logger.info("🧩 [Redis] Redis client loaded.");

// =====================================================
// 📅 Import Cron Jobs (self-scheduling ones only)
// =====================================================
import "../cron/LiveMatchPoolGeneratorCron.js";
import "../cron/flushBets.js";
import "../cron/MatchStatusWatcher.js";
import "../cron/fetchMatchesCron.js";
import { startCleanupCron } from "../cron/cleanupMatchesCron.js";
import ConsensusPoolMaturityCron from "../cron/ConsensusPoolMaturityCron.js";

// =====================================================
// 💸 Import Payout Processor
// =====================================================
import { runPayoutCycle } from "../worker/payoutProcessor.js";

// =====================================================
// 🧩 Single-Instance Protection
// =====================================================
if (global.botInstanceAlreadyStarted) {
  logger.warn("⚠️ Duplicate bot.js import detected — reusing existing instance.");
} else {
  global.botInstanceAlreadyStarted = true;
}

// =====================================================
// ⚙️ Create Telegraf Bot Instance
// =====================================================
const bot = new Telegraf(token);
logger.info("🤖 [Bot] Telegram bot instance created successfully.");

// Expose globally (for cron workers, payout processor, Redis locks, etc.)
global.bot = bot;

// =====================================================
// 🧠 Local Session (in-memory + persisted JSON)
// =====================================================
const session = new LocalSession({
  database: "sessions.json",
  storage: LocalSession.storageFileAsync,
});
bot.use(session.middleware());
logger.info("🧠 [Session] LocalSession middleware attached.");

// =====================================================
// 🧩 Import Bot Handlers
// =====================================================
import startHandler from "./handlers/startHandler.js";
import helpHandler from "./handlers/helpHandler.js";
import howToPlayHandler from "./handlers/howToPlayHandler.js";
import matchHandler from "./handlers/matchHandler.js";
import preMatchBetHandler from "./handlers/preMatchBetHandler.js";
import liveMatchBetHandler from "./handlers/liveMatchBetHandler.js";
import myBetsHandler from "./handlers/myBetsHandler.js";
import betHandler from "./handlers/betHandler.js";
import cancelBetHandler from "./handlers/cancelBetHandler.js";
import walletHandler from "./handlers/walletHandler.js";
import checkBalanceHandler from "./handlers/checkBalanceHandler.js";
import newUserHandler from "./handlers/newUserHandler.js";
import adminPollHandler from "./handlers/adminPollHandler.js";
ConsensusPoolMaturityCron(bot);

// =====================================================
// 🧩 Register Handlers (in strict order)
// =====================================================
try {
  newUserHandler(bot); // must be FIRST
  adminPollHandler(bot);
  startHandler(bot);
  helpHandler(bot);
  howToPlayHandler(bot);
  matchHandler(bot);
  preMatchBetHandler(bot);
  liveMatchBetHandler(bot);
  betHandler(bot);       // Redis locks will be used inside this handler
  cancelBetHandler(bot);
  myBetsHandler(bot);
  walletHandler(bot);
  checkBalanceHandler(bot);

  logger.info("✅ [Handlers] All bot handlers loaded successfully.");
} catch (err) {
  logger.error(`❌ [Handlers] Failed to initialize: ${err.message}`);
  process.exit(1);
}

// =====================================================
// 🚀 Launch Bot (only if executed directly, not imported)
// =====================================================
if (process.argv[1]?.includes("bot.js")) {
  (async () => {
    try {
      // Force IPv4 to avoid DNS issues
      if (!process.env.NODE_OPTIONS?.includes("--dns-result-order")) {
        process.env.NODE_OPTIONS = "--dns-result-order=ipv4first";
      }

      await bot.launch();
      logger.info("🚀 Bot launched successfully and is polling for updates...");

      // Start explicit scheduled crons
      startCleanupCron();

      // 🪙 Start periodic payout processor
      setInterval(() => {
        runPayoutCycle(10)
          .then(() => logger.debug("💸 [PayoutCycle] Scan complete"))
          .catch((err) => logger.warn("⚠️ PayoutCycle error: " + err.message));
      }, 15000);

    } catch (err) {
      if (err.response?.error_code === 409) {
        logger.error("❌ Telegram says another poller is active (409 Conflict).");
        logger.warn("💡 Fix: Stop existing Node process or reboot VPS.");
      } else {
        logger.error(`❌ Bot launch failed: ${err.message}`);
      }
      process.exit(1);
    }
  })();
} else {
  logger.info("🧩 [Bot] Imported as module (no polling started).");
}

// =====================================================
// 💓 Heartbeat (every 3h)
// =====================================================
setInterval(() => {
  logger.info("✅ [Heartbeat] Bot is alive and polling normally.");
}, 3 * 60 * 60 * 1000);

// =====================================================
// 🧹 Graceful Shutdown
// =====================================================
const shutdown = (signal) => {
  logger.warn(`⚠️ Received ${signal}. Stopping bot gracefully...`);
  try {
    bot.stop(signal);
  } finally {
    process.exit(0);
  }
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

// =====================================================
// 🌐 Global Error Guards
// =====================================================
process.on("unhandledRejection", (err) => {
  logger.error(`⚠️ Unhandled rejection: ${err.message}`);
});
process.on("uncaughtException", (err) => {
  logger.error(`⚠️ Uncaught exception: ${err.message}`);
});

// =====================================================
// 📤 Export bot instance
// =====================================================
export default bot;
