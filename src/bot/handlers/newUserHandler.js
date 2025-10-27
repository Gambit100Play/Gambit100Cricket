// src/bot/handlers/newUserHandler.js
import { Markup } from "telegraf";
import { updateUser, getUserById } from "../../db/db.js";

export default function newUserHandler(bot) {
  // Ask for phone number
  bot.action("provide_phone", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply("📱 Please send me your *phone number with country code* (e.g. +91XXXXXXXXXX):", {
      parse_mode: "Markdown"
    });
    ctx.session.awaitingPhone = true;
  });

  // Capture phone number
  bot.on("text", async (ctx, next) => {
    const userId = ctx.from.id;
    const user = await getUserById(userId);

    if (ctx.session.awaitingPhone && /^\+\d{10,15}$/.test(ctx.message.text)) {
      await updateUser(userId, { phone: ctx.message.text });
      ctx.session.awaitingPhone = false;
      return ctx.reply("✅ Phone number saved!\n\nNow please send your 📧 *email address*:", {
        parse_mode: "Markdown"
      });
    }

    if (ctx.session.awaitingEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.message.text)) {
      await updateUser(userId, { email: ctx.message.text });
      ctx.session.awaitingEmail = false;
      return ctx.reply(
        "✅ Email saved!\n\nNow, connect your wallet to unlock betting:",
        Markup.inlineKeyboard([
          [Markup.button.callback("🔗 Connect Wallet", "connect_wallet")]
        ])
      );
    }

    return next();
  });

  // When wallet connected (mocked for now)
  bot.action("connect_wallet", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;

    // Update DB that wallet is connected
    await updateUser(userId, { wallet_connected: true, status: "verified" });

    ctx.reply("🔗 Wallet connected successfully!\n\n🎉 You can now place bets.");
  });

  // Block bet placement if user not verified
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const user = await getUserById(userId);
    if (user && user.status !== "verified") {
      if (ctx.callbackQuery?.data?.startsWith("bet_")) {
        return ctx.reply("⚠️ You must provide your phone, email, and connect wallet before placing bets.");
      }
    }
    return next();
  });
}
