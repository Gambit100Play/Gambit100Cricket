// src/bot/bot.js
import { Telegraf } from "telegraf";
import LocalSession from "telegraf-session-local";
import cron from "node-cron";
import dotenv from "dotenv";

// ---------------- Handler Imports ----------------
import startHandler from "./handlers/startHandler.js";
import betHandler from "./handlers/betHandler.js";
import matchHandler from "./handlers/matchHandler.js";
import preMatchBetHandler from "./handlers/preMatchBetHandler.js";
import liveMatchBetHandler from "./handlers/liveMatchBetHandler.js";
import helpHandler from "./handlers/helpHandler.js";
import howToPlayHandler from "./handlers/howToPlayHandler.js";
import myBetsHandler from "./handlers/myBetsHandler.js";
import connectWalletHandler from "./handlers/connectWalletHandler.js";
import checkBalanceHandler from "./handlers/checkBalanceHandler.js";

// ---------------- Background Jobs ----------------
import { startDepositWatcher } from "../cron/depositWatcher.js";
import "../cron/cleanupMatchesCron.js";
import "../cron/markCompletedMatches.js";
import "../cron/liveScoreUpdaterCron.js";   // ✅ Live score updates
import "../cron/fetchMatchesCron.js";       // ✅ New match fetch cron

dotenv.config();

export function createBot(token) {
  if (!token) throw new Error("❌ BOT_TOKEN missing or invalid.");

  const bot = new Telegraf(token);

  // 🧠 Safety for unhandled promise rejections
  process.on("unhandledRejection", (reason) =>
    console.error("⚠️ Unhandled Rejection:", reason)
  );
  process.on("uncaughtException", (err) =>
    console.error("💥 Uncaught Exception:", err)
  );

  // 🧩 Global safeguard for expired Telegram callbacks
  bot.on("callback_query", async (ctx, next) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      console.log("⚠️ Ignored expired or invalid callback_query.");
    }
    return next();
  });

  // 🗂️ Local Session (saved in sessions.json)
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

  // 🧩 Session Debug Logger
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id || "unknown";
    const keys = ctx.session ? Object.keys(ctx.session) : [];
    console.log(
      `💾 [Session] user=${userId} keys=${keys.length ? keys.join(", ") : "empty"}`
    );
    await next();
  });

  // 🗨️ Global text logger
  bot.on("text", (ctx, next) => {
    console.log("🟢 [Text]", ctx.from.id, ":", ctx.message.text);
    return next();
  });

  // =====================================================
  // 🧩 Register all handlers in **DEPENDENCY ORDER**
  // =====================================================
  startHandler(bot);
  betHandler(bot);
  matchHandler(bot);
  preMatchBetHandler(bot);
  liveMatchBetHandler(bot);
  myBetsHandler(bot);
  connectWalletHandler(bot);
  checkBalanceHandler(bot);
  helpHandler(bot);
  howToPlayHandler(bot);

  console.log("✅ Handlers loaded successfully.");

  // 👀 Start deposit watcher
  try {
    startDepositWatcher(bot);
    console.log("👀 Deposit watcher active.");
  } catch (err) {
    console.error("⚠️ Failed to start deposit watcher:", err.message);
  }

  return bot;
}
