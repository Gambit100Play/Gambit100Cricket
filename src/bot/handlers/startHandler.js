import { Markup } from "telegraf";

// 🧩 Helper — Main Menu UI
function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎯 Play Now", "matches")],
    [Markup.button.callback("📜 My Play", "my_bets")],
    [Markup.button.callback("💰 Wallet", "wallet_menu")],
    [
      Markup.button.callback("❓ How to Play", "how_to_play"),
      Markup.button.callback("🆘 Help", "help"),
    ],
    [Markup.button.url("🌐 Visit Site", "https://cricpredict.in")],
  ]);
}

export default function startHandler(bot) {
  // 🏁 /start — Entry point for every user
  bot.start(async (ctx) => {
    const user = ctx.from;
    const firstName = user?.first_name || "Player";

    try {
      const welcomeMessage =
        `🏏 *Welcome to CricPredict*, ${firstName}!\n\n` +
        `CricPredict is a skill-based cricket prediction platform where you can:\n\n` +
        `• 🎯 Predict match outcomes (Pre-match & Live)\n` +
        `• 💰 Earn G-Tokens and win TRC-20 USDT\n` +
        `• 🏆 Track your progress and rewards\n\n` +
        `Get started by choosing an option below 👇`;

      await ctx.reply(welcomeMessage, {
        parse_mode: "Markdown",
        ...mainMenu(),
      });
    } catch (err) {
      console.error("Error in /start:", err);
      await ctx.reply(
        "⚠️ Something went wrong while starting. Please try again later."
      );
    }
  });

  // 🔙 Back to Main Menu
  bot.action("main_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("🏠 *Main Menu*", {
      parse_mode: "Markdown",
      ...mainMenu(),
    });
  });
}
