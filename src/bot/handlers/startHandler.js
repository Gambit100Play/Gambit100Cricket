// src/bot/handlers/startHandler.js
import { Markup } from "telegraf";
import { logger } from "../../utils/logger.js";
import { DateTime } from "luxon";

/* ============================================================
 🧹 Escape MarkdownV2 safely (Telegram-compliant)
============================================================ */
function escapeMdV2(text = "") {
  try {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
  } catch {
    return text;
  }
}

/* ============================================================
 💬 Dynamic Greeting (based on IST)
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
    [Markup.button.callback("💰 Wallet", "wallet_menu")], // ✅ this triggers walletHandler
    [
      Markup.button.callback("❓ How to Play", "how_to_play"),
      Markup.button.callback("🆘 Help", "help"),
    ],
    [Markup.button.url("🌐 Visit Site", "https://cricpredict.in")],
  ]);
}

/* ============================================================
 🚀 Start Handler
============================================================ */
export default function startHandler(bot) {
  // 🟢 /start entry point
  bot.startHandler = async (ctx) => {
    const userId = ctx.from?.id;
    const firstName = escapeMdV2(ctx.from?.first_name || "Player");
    const username = ctx.from?.username ? `@${ctx.from.username}` : "N/A";
    logger.info(`🏁 [Start] Triggered by user=${userId} (${username})`);

    const greeting = escapeMdV2(getGreeting());

    const welcomeMessage =
      `🏏 *Welcome to CricPredict*, ${firstName}\\!\n\n` +
      `${greeting}\\! 👋\n\n` +
      `CricPredict lets you:\n` +
      `• 🎯 Predict match outcomes \\(Pre\\-match & Live\\)\n` +
      `• 💰 Earn G\\-Tokens and win TRC\\-20 USDT\n` +
      `• 🏆 Track your rewards and rankings\n\n` +
      `Choose an option below 👇`;

    try {
      await ctx.reply(welcomeMessage, {
        parse_mode: "MarkdownV2",
        reply_markup: mainMenu().reply_markup,
      });
      logger.info(`📨 [Start] Sent welcome menu to user=${userId}`);
    } catch (err) {
      logger.error(
        `❌ [Start] Failed to send welcome message for user=${userId}: ${err.message}`
      );
    }
  };

  // 🧭 /start command listener
  bot.start(async (ctx) => {
    try {
      await bot.startHandler(ctx);
    } catch (err) {
      logger.error(`⚠️ [StartCommand] Error handling /start: ${err.message}`);
    }
  });

  /* ============================================================
   🏠 Main Menu (callback from any submenu)
  ============================================================= */
  bot.action("main_menu", async (ctx) => {
    const userId = ctx.from?.id;
    const firstName = escapeMdV2(ctx.from?.first_name || "Player");
    const greeting = escapeMdV2(getGreeting());
    logger.info(`🏠 [MainMenu] Callback triggered by user=${userId}`);

    try {
      await ctx.answerCbQuery();
    } catch (err) {
      logger.warn(`⚠️ [MainMenu] Failed to answerCbQuery: ${err.message}`);
    }

    const text =
      `🏏 *Welcome back*, ${firstName}\\!\n\n` +
      `${greeting}, ready to make your next move 👇`;

    try {
      await ctx.editMessageText(text, {
        parse_mode: "MarkdownV2",
        reply_markup: mainMenu().reply_markup,
      });
      logger.info(`✅ [MainMenu] Updated message for user=${userId}`);
    } catch (err) {
      // Handle "message is not modified" gracefully
      if (err.description?.includes("message is not modified")) return;

      logger.warn(`⚠️ [MainMenu] Edit failed (${err.message}) — sending fresh menu.`);
      try {
        await ctx.reply(text, {
          parse_mode: "MarkdownV2",
          reply_markup: mainMenu().reply_markup,
        });
        logger.info(`📨 [MainMenu] Sent new main menu to user=${userId}`);
      } catch (sendErr) {
        logger.error(`❌ [MainMenu] Failed to send fallback menu: ${sendErr.message}`);
      }
    }
  });
}
