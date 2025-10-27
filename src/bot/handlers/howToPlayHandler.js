// src/bot/handlers/howToPlayHandler.js
import { Markup } from "telegraf";

export default function howToPlayHandler(bot) {
  bot.action("how_to_play", async (ctx) => {
    await ctx.answerCbQuery();

    ctx.reply(
      `📖 *How to Play CricPredict*\n\n` +
      `1️⃣ *Connect Wallet* → Link your crypto wallet securely.\n` +
      `2️⃣ *Choose a Match* → Pick from today's matches.\n` +
      `3️⃣ *Place Bets* → Pre-match or live bets.\n` +
      `4️⃣ *Track My Bets* → Monitor active bets.\n` +
      `5️⃣ *Win & Withdraw* → Collect rewards instantly.\n\n` +
      `⚡ It's simple: *Predict. Play. Win.*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("ℹ️ Help", "help")],
          [Markup.button.callback("🔙 Back to Main Menu", "main_menu")]
        ])
      }
    );
  });
}
