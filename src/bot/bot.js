// =====================================================
// 🤖 TELEGRAM BOT — SINGLE ENTRY POINT (Stable Production-Ready Version)
// =====================================================
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import LocalSession from "telegraf-session-local";
import { logger } from "../utils/logger.js";

// =====================================================
// 📅 Import cron jobs (only those that self-schedule safely)
// =====================================================
import "../cron/PreMatchBetLockCron.js";
import "../cron/LiveMatchPoolGeneratorCron.js";
import "../cron/liveScoreUpdaterCron.js";
import "../cron/LockMatchCron.js";
import "../cron/flushBets.js";

// 🟠 Explicit start crons
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

// 🔗 Named imports for wallet linking
import { handleWalletLinkFlow, processWalletAddress } from "./handlers/connectWalletHandler.js";

// Not a handler — utility
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

// 🧠 Enable LocalSession (required for play + wallet flow)
const session = new LocalSession({
  database: "sessions.json",
  storage: LocalSession.storageFileAsync, // async safe disk writes
});
bot.use(session.middleware());
logger.info("🧠 [Session] LocalSession middleware attached.");

// =====================================================
// 🧩 Register Bot Handlers (Order Matters)
// =====================================================
try {
  // 🏁 Core user interactions
  startHandler(bot);
  helpHandler(bot);
  howToPlayHandler(bot);
  newUserHandler(bot);

  // 🏏 Match + Betting Handlers
  matchHandler(bot);
  preMatchBetHandler(bot);
  liveMatchBetHandler(bot);
  betHandler(bot);
  cancelBetHandler(bot);
  myBetsHandler(bot);

  // 💰 Wallet System
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
    await bot.launch();
    logger.info("🚀 Bot launched successfully and is polling for updates...");

    // Start explicit cron jobs
    startCleanupCron();
  } catch (err) {
    if (err.response?.error_code === 409) {
      logger.error("❌ Telegram says another poller is active (409 Conflict).");
      logger.warn("💡 Fix: Stop any running Node process or reboot the VPS.");
      process.exit(0);
    } else {
      logger.error(`❌ Bot launch failed: ${err.message}`);
      process.exit(1);
    }
  }
})();

// =====================================================
// 💓 Heartbeat log — simple uptime visibility
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
// 📤 Export bot instance
// =====================================================
export default bot;
