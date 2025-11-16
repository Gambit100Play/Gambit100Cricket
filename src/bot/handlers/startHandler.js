// =====================================================
// 🚀 START HANDLER — Auto Register New Users + Show Menu (v3.9 HTML-Stable)
// =====================================================
import { Markup } from "telegraf";
import { logger } from "../../utils/logger.js";
import { DateTime } from "luxon";
import { getUserById, createOrUpdateUser } from "../../db/db.js";

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
    { reply_markup: btn.reply_markup }
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

      // 2️⃣ Prepare welcome text (HTML-safe)
      const greeting = getGreeting();
      const name = firstName || "Player";

      const welcomeMessage = `
<b>🏏 Welcome to CricPredict</b>, ${name}!  
${greeting}! 👋  

CricPredict lets you:  
• 🎯 Predict match outcomes (Pre-match & Live)  
• 💰 Earn G-Tokens and win TRC-20 USDT  
• 🏆 Track your rewards and rankings  

<b>Choose an option below 👇</b>
      `;

      // Send via Telegram API to ensure HTML rendering
      await ctx.telegram.sendMessage(ctx.chat.id, welcomeMessage, {
        parse_mode: "HTML",
        reply_markup: mainMenu().reply_markup,
      });

      logger.info(`📨 [Start] Sent welcome menu to user=${userId}`);
    } catch (err) {
      logger.error(`❌ [StartHandler] ${err.message}`);
      await ctx.reply(
        "⚠️ Something went wrong while initializing your account. Please try again later."
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

    const text = `
<b>🏏 Welcome back</b>, ${first}!  
${greeting}, ready to make your next move 👇
    `;

    try {
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: mainMenu().reply_markup,
      });
      logger.info(`✅ [MainMenu] Updated for user=${userId}`);
    } catch (err) {
      if (!err.description?.includes("message is not modified")) {
        await ctx.reply(text, {
          parse_mode: "HTML",
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
