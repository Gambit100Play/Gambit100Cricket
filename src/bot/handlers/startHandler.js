// src/bot/handlers/startHandler.js


// =====================================================
// 🚀 START HANDLER — Auto Register New Users + Show Menu (v3.7 Stable Markdown-Safe)
// =====================================================
import { Markup } from "telegraf";
import { logger } from "../../utils/logger.js";
import { DateTime } from "luxon";
import { getUserById, createOrUpdateUser } from "../../db/db.js";
import { safeMarkdown } from "../../utils/markdown.js";

/* ============================================================
 💬 Greeting Based on Time (IST)
============================================================ */
function getGreeting() {
  const hour = DateTime.now().setZone("Asia/Kolkata").hour;
  if (hour < 12) return "🌅 Good Morning";
  if (hour < 18) return "🌞 Good Afternoon";
  return "🌙 Good Evening";
}

/* ============================================================
 🎛️ Main Menu Layout
============================================================ */
function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎯 Play Now", "matches")],
    [Markup.button.callback("📜 My Plays", "my_bets")],
    [Markup.button.callback("💰 Wallet", "wallet_menu")],
    [
      Markup.button.callback("❓ How to Play", "how_to_play"),
      Markup.button.callback("🆘 Help", "help"),
    ],
    [Markup.button.url("🌐 Visit Site", "https://cricpredict.in")],
  ]);
}

/* ============================================================
 🆕 Simple “Play Now” Reopen Prompt
============================================================ */
function showPlayNowButton(ctx) {
  const btn = Markup.inlineKeyboard([
    [Markup.button.callback("🎯 Play Now", "start_menu")],
  ]);
  return ctx.reply(
  "👋 Welcome back! Tap below to reopen the CricPredict menu:",
  { parse_mode: "MarkdownV2" } // wrapper will safely escape it since no __escaped flag
);
}

/* ============================================================
 🚀 START HANDLER
============================================================ */
export default function startHandler(bot) {
  bot.startHandler = async (ctx) => {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || null;
    const firstName = ctx.from?.first_name || "";
    const lastName = ctx.from?.last_name || "";

    if (!userId) {
      logger.warn("⚠️ [Start] No user ID found in context.");
      return;
    }

    try {
      // 1️⃣ Register or fetch user
      let user = await getUserById(userId);
      if (!user) {
        await createOrUpdateUser(userId, username, firstName, lastName);
        logger.info(`👋 [Start] Registered new user ${userId} (${username || "N/A"})`);
      }

      // 2️⃣ Prepare welcome text
      const greeting = getGreeting();
      const name = safeMarkdown(firstName || "Player");

      // Escape all parentheses and dashes manually before applying safeMarkdown
      const rawWelcome =
        `🏏 *Welcome to CricPredict*, ${name}!\n\n` +
        `${greeting}! 👋\n\n` +
        `CricPredict lets you:\n` +
        `• 🎯 Predict match outcomes \\(Pre-match & Live\\)\n` +
        `• 💰 Earn G-Tokens and win TRC\\-20 USDT\n` +
        `• 🏆 Track your rewards and rankings\n\n` +
        `Choose an option below 👇`;

      // Use safeMarkdown once at the end to sanitize any other special chars
      const welcomeMessage = rawWelcome; // already manually escaped where needed
await ctx.reply(welcomeMessage, {
  parse_mode: "MarkdownV2",
  __escaped: true,
  reply_markup: mainMenu().reply_markup,
}).catch(async (err) => {
        logger.warn(`⚠️ [StartHandler] Markdown parse issue: ${err.message}`);
        await ctx.reply(rawWelcome); // fallback plain text
      });

      logger.info(`📨 [Start] Sent welcome menu to user=${userId}`);
    } catch (err) {
      logger.error(`❌ [StartHandler] ${err.message}`);
      await ctx.reply(
        safeMarkdown(
          "⚠️ Something went wrong while initializing your account. Please try again later."
        ),
        { parse_mode: "MarkdownV2" }
      );
    }
  };

  // 🎬 Bind /start command
  bot.start(async (ctx) => {
    await bot.startHandler(ctx);
  });

  // 🏠 Main Menu return
  bot.action("main_menu", async (ctx) => {
    const userId = ctx.from?.id;
    const first = ctx.from?.first_name || "Player";
    const greeting = getGreeting();

    try {
      await ctx.answerCbQuery();
    } catch {}

    const text =
  `🏏 *Welcome back*, ${safeMarkdown(first)}!\n\n` +
  `${greeting}, ready to make your next move 👇`;


    try {
      await ctx.editMessageText(text, {
        parse_mode: "MarkdownV2",
        reply_markup: mainMenu().reply_markup,
      });
      logger.info(`✅ [MainMenu] Updated for user=${userId}`);
    } catch (err) {
      if (!err.description?.includes("message is not modified")) {
        await ctx.reply(text, {
          parse_mode: "MarkdownV2",
          reply_markup: mainMenu().reply_markup,
        });
      }
    }
  });

  // 🧭 /menu fallback
  bot.command("menu", async (ctx) => {
    await showPlayNowButton(ctx);
  });

  // 🆕 “Play Now” button fallback
  bot.action("start_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await bot.startHandler(ctx);
  });
}
