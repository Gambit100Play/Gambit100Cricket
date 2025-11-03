// =====================================================
// 🏏 CricPredict — Telegram Bot Bootstrap (Final Version)
// =====================================================
import { Telegraf } from "telegraf";
import LocalSession from "telegraf-session-local";
import dotenv from "dotenv";
dotenv.config();

// ---------------- Logger ----------------
import { logger } from "../utils/logger.js";

// ---------------- Handler Imports ----------------
import startHandler from "./handlers/startHandler.js";
import walletHandler from "./handlers/walletHandler.js"; // ✅ Unified wallet handler
import betHandler from "./handlers/betHandler.js";
import matchHandler from "./handlers/matchHandler.js";
import preMatchBetHandler from "./handlers/preMatchBetHandler.js";
import liveMatchBetHandler from "./handlers/liveMatchBetHandler.js";
import helpHandler from "./handlers/helpHandler.js";
import howToPlayHandler from "./handlers/howToPlayHandler.js";
import myBetsHandler from "./handlers/myBetsHandler.js";
import cancelBetHandler from "./handlers/cancelBetHandler.js"; // ✅ loaded AFTER myBetsHandler
import connectWalletHandler from "./handlers/connectWalletHandler.js";

// ---------------- Background Jobs ----------------
import { startDepositWatcher } from "../cron/depositWatcher.js";
import "../cron/cleanupMatchesCron.js";
import "../cron/markCompletedMatches.js";
import "../cron/liveScoreUpdaterCron.js";
import "../cron/fetchMatchesCron.js";
import "../cron/fetchUpcomingCron.js";

// =====================================================
// 🧩 BOT CREATOR FUNCTION
// =====================================================
export function createBot(token) {
  if (!token) throw new Error("❌ BOT_TOKEN missing or invalid.");

  const bot = new Telegraf(token);
  logger.info("🚀 [Bot] Initializing CricPredict bot...");

  // =====================================================
  // 🧱 Global Error Management
  // =====================================================
  process.on("unhandledRejection", (reason) =>
    logger.error(`⚠️ Unhandled Rejection: ${reason}`)
  );
  process.on("uncaughtException", (err) =>
    logger.error(`💥 Uncaught Exception: ${err.message}\n${err.stack}`)
  );

  // Gracefully handle stale callback queries
  bot.on("callback_query", async (ctx, next) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      logger.warn("⚠️ Ignored expired or invalid callback_query.");
    }
    return next();
  });

  // =====================================================
  // 💾 Local Session Setup
  // =====================================================
  const localSession = new LocalSession({
    database: "sessions.json",
    storage: LocalSession.storageFileAsync,
    property: "session",
    format: {
      serialize: (obj) => JSON.stringify(obj, null, 2),
      deserialize: (str) => JSON.parse(str),
    },
  });
  bot.use(localSession.middleware());

  // Session + text log middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id || "unknown";
    const keys = ctx.session ? Object.keys(ctx.session) : [];
    logger.info(
      `💾 [Session] user=${userId} keys=${keys.length ? keys.join(", ") : "empty"}`
    );
    await next();
  });

  bot.on("text", (ctx, next) => {
    logger.info(`🟢 [Text] ${ctx.from?.id}: ${ctx.message.text}`);
    return next();
  });

  // =====================================================
  // 🧩 Register Handlers (ordered)
  // =====================================================
  startHandler(bot);          // /start command and main menu
  connectWalletHandler(bot);
  walletHandler(bot);         // ✅ unified wallet system (deposit + link + balance)
  betHandler(bot);
  matchHandler(bot);
  preMatchBetHandler(bot);
  liveMatchBetHandler(bot);
  helpHandler(bot);
  howToPlayHandler(bot);
  myBetsHandler(bot);
  cancelBetHandler(bot);      // keep this last for safety

  logger.info("✅ [Handlers] All bot handlers registered successfully.");

  // =====================================================
  // 🔗 Cross-Handler Helpers
  // =====================================================
  bot.showBalance = async (ctx) => {
    try {
      if (typeof bot.checkBalance === "function") {
        await bot.checkBalance(ctx);
      } else {
        logger.warn("⚠️ [showBalance] checkBalance handler not attached yet.");
        await ctx.reply("⚠️ Wallet handler unavailable. Try again soon.");
      }
    } catch (err) {
      logger.error(`⚠️ [showBalance] Failed: ${err.message}`);
      await ctx.reply("⚠️ Could not load your wallet right now.");
    }
  };

  bot.showMainMenu = async (ctx) => {
    try {
      if (typeof bot.startHandler === "function") {
        await bot.startHandler(ctx);
      } else {
        logger.warn("⚠️ [showMainMenu] startHandler not attached yet.");
      }
    } catch (err) {
      logger.error(`⚠️ [showMainMenu] Failed: ${err.message}`);
    }
  };

  // =====================================================
  // 👀 Deposit Watcher
  // =====================================================
  try {
    startDepositWatcher(bot);
    logger.info("👀 [DepositWatcher] Active and monitoring deposits.");
  } catch (err) {
    logger.error(`⚠️ [DepositWatcher] Failed to start: ${err.message}`);
  }

  return bot;
}

// =====================================================
// 🚀 BOT INSTANCE + MATCH START WATCHER
// =====================================================
const bot = createBot(process.env.BOT_TOKEN);

(async () => {
  try {
    const { scheduleMatchStartWatchers } = await import("../cron/MatchStartWatcher.js");
    await scheduleMatchStartWatchers(bot);
    logger.info("🕒 [MatchStartWatcher] Initialized successfully.");

    // Hourly refresh
    setInterval(async () => {
      try {
        await scheduleMatchStartWatchers(bot);
        logger.info("🔁 [MatchStartWatcher] Refreshed successfully.");
      } catch (err) {
        logger.error(`⚠️ [MatchStartWatcher] Hourly refresh failed: ${err.message}`);
      }
    }, 60 * 60 * 1000);
  } catch (err) {
    logger.error(`❌ [MatchStartWatcher] Initialization failed: ${err.message}`);
  }
})();

// =====================================================
// 🚀 LAUNCH BOT (Missing earlier — now fixed!)
// =====================================================
(async () => {
  try {
    await bot.launch();
    logger.info("🤖 [Bot] CricPredict is now live and listening for updates!");
  } catch (err) {
    logger.error(`❌ [Bot] Launch failed: ${err.message}`);
  }
})();

// Graceful shutdown hooks
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// =====================================================
// 📤 Export Bot
// =====================================================
export default bot;
