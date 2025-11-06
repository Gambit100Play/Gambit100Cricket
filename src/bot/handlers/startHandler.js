// =====================================================
// 🚀 START HANDLER — Auto Register New Users + Show Menu (v2.1)
// =====================================================
import { Markup } from "telegraf";
import { logger } from "../../utils/logger.js";
import { DateTime } from "luxon";
import { getUserById, createOrUpdateUser } from "../../db/db.js";
import { getOrCreateDepositAddress } from "../../utils/generateDepositAddress.js";

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
    [Markup.button.callback("💰 Wallet", "wallet_menu")],
    [
      Markup.button.callback("❓ How to Play", "how_to_play"),
      Markup.button.callback("🆘 Help", "help"),
    ],
    [Markup.button.url("🌐 Visit Site", "https://cricpredict.in")],
  ]);
}

/* ============================================================
 🆕 Fallback “Play Now” Button — when chat is empty
============================================================ */
function showPlayNowButton(ctx) {
  const btn = Markup.inlineKeyboard([
    [Markup.button.callback("🎯 Play Now", "start_menu")],
  ]);

  return ctx.reply(
    "👋 Welcome back! Tap below to reopen the CricPredict menu:",
    btn
  );
}

/* ============================================================
 🚀 START HANDLER — with auto user registration
============================================================ */
export default function startHandler(bot) {
  // 🧠 Main /start logic
  bot.startHandler = async (ctx) => {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || null;
    const firstName = ctx.from?.first_name || "";
    const lastName = ctx.from?.last_name || "";

    if (!userId) return logger.warn("⚠️ [Start] No user ID found in context.");

    try {
      // Step 1️⃣: Check if user exists
      let user = await getUserById(userId);

      if (!user) {
        // Step 2️⃣: Register new user
        await createOrUpdateUser(userId, username, firstName, lastName);
        logger.info(`👋 [Start] New user registered: ${userId} (${username || "N/A"})`);

        // Step 3️⃣: Generate deposit wallet
        try {
          const address = await getOrCreateDepositAddress(userId);
          logger.info(`💰 [Start] Assigned TRON deposit address to ${userId}: ${address}`);
        } catch (walletErr) {
          logger.error(`❌ [Start] Wallet creation failed: ${walletErr.message}`);
        }
      }

      // Step 4️⃣: Build welcome message
      const first = escapeMdV2(firstName || "Player");
      const greeting = escapeMdV2(getGreeting());

      const welcomeMessage =
        `🏏 *Welcome to CricPredict*, ${first}\\!\n\n` +
        `${greeting}\\! 👋\n\n` +
        `CricPredict lets you:\n` +
        `• 🎯 Predict match outcomes \\(Pre\\-match & Live\\)\n` +
        `• 💰 Earn G\\-Tokens and win TRC\\-20 USDT\n` +
        `• 🏆 Track your rewards and rankings\n\n` +
        `Choose an option below 👇`;

      await ctx.reply(welcomeMessage, {
        parse_mode: "MarkdownV2",
        reply_markup: mainMenu().reply_markup,
      });

      logger.info(`📨 [Start] Sent welcome menu to user=${userId}`);
    } catch (err) {
      logger.error(`❌ [StartHandler] Error: ${err.message}`);
      await ctx.reply("⚠️ Something went wrong while initializing your account. Please try again later.");
    }
  };

  // 🧭 Bind /start command
  bot.start(async (ctx) => {
    await bot.startHandler(ctx);
  });

  // 🏠 Back to Main Menu handler
  bot.action("main_menu", async (ctx) => {
    const userId = ctx.from?.id;
    const first = escapeMdV2(ctx.from?.first_name || "Player");
    const greeting = escapeMdV2(getGreeting());

    try {
      await ctx.answerCbQuery();
    } catch {}

    const text =
      `🏏 *Welcome back*, ${first}\\!\n\n` +
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

  // 🆕 Handle fallback “Play Now” (no active chat)
  bot.action("start_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await bot.startHandler(ctx);
  });

  // 🆕 Fallback for sessions without chat history
  bot.command("menu", async (ctx) => {
    await showPlayNowButton(ctx);
  });
}
