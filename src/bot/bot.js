// =====================================================
// 🤖 TELEGRAM BOT — SINGLE ENTRY POINT (Stable Production-Ready v3.1)
// =====================================================
import dotenv from "dotenv";
import { Telegraf, Markup } from "telegraf";
import LocalSession from "telegraf-session-local";
import { logger } from "../utils/logger.js";

// =====================================================
// 📅 Import cron jobs (only those that self-schedule safely)
// =====================================================
import "../cron/LiveMatchPoolGeneratorCron.js";
import "../cron/flushBets.js";
import "../cron/MatchStatusWatcher.js";
import { startCleanupCron } from "../cron/cleanupMatchesCron.js";
import "../cron/fetchMatchesCron.js";

// =====================================================
// 🤖 Import Bot Handlers
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
import { getOrCreateDepositAddress } from "../utils/generateDepositAddress.js";

// =====================================================
// 🔐 Environment setup & validation
// =====================================================
dotenv.config();
const token = process.env.BOT_TOKEN;
if (!token) {
  logger.error("❌ BOT_TOKEN missing in .env file");
  process.exit(1);
}

// =====================================================
// 🧩 Single-instance protection
// =====================================================
if (global.botInstanceAlreadyStarted) {
  logger.warn("⚠️ Duplicate bot.js import detected — skipping startup.");
  process.exit(0);
}
global.botInstanceAlreadyStarted = true;

// =====================================================
// ⚙️ Create Telegraf bot instance + Sessions
// =====================================================
const bot = new Telegraf(token);
logger.info("🤖 [Bot] Telegram bot instance created successfully.");

const session = new LocalSession({
  database: "sessions.json",
  storage: LocalSession.storageFileAsync,
});
bot.use(session.middleware());
logger.info("🧠 [Session] LocalSession middleware attached.");

// =====================================================
// 🧩 Register Handlers
// =====================================================
// =====================================================
// 🧩 Register Handlers (fixed order)
// =====================================================
try {
  newUserHandler(bot);    // ✅ must come FIRST
  startHandler(bot);
  helpHandler(bot);
  howToPlayHandler(bot);
  matchHandler(bot);
  preMatchBetHandler(bot);
  liveMatchBetHandler(bot);
  betHandler(bot);
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
// 🚀 Launch the bot (polling mode)
// =====================================================
(async () => {
  try {
    // Force IPv4 to avoid Node’s IPv6 bug
    if (!process.env.NODE_OPTIONS?.includes("--dns-result-order")) {
      process.env.NODE_OPTIONS = "--dns-result-order=ipv4first";
    }

    await bot.launch();
    logger.info("🚀 Bot launched successfully and is polling for updates...");

    // Start explicit cron jobs
    startCleanupCron();
  } catch (err) {
    if (err.response?.error_code === 409) {
      logger.error("❌ Telegram says another poller is active (409 Conflict).");
      logger.warn("💡 Fix: Stop any running Node process or reboot the VPS.");
    } else {
      logger.error(`❌ Bot launch failed: ${err.message}`);
    }
    process.exit(1);
  }
})();

// =====================================================
// 💓 Heartbeat
// =====================================================
setInterval(() => {
  logger.info("✅ [Heartbeat] Bot is alive and polling normally.");
}, 3 * 60 * 60 * 1000);

// =====================================================
// 🧹 Graceful shutdown
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
// 🌐 Global error guards (prevents ECONNRESET crash)
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
