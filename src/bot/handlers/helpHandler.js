// src/bot/handlers/helpHandler.js
import { Markup } from "telegraf";

export default function helpHandler(bot) {
  // Inline button handler
  bot.action("help", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply(
      `ℹ️ *Help Menu*\n\n` +
      `- Use /start to return to the main menu.\n` +
      `- 📅 *Today’s Matches* → view available matches.\n` +
      `- 🎟 *My Bets* → see your active bets.\n` +
      `- 🔗 *Connect Wallet* → link your crypto wallet.\n\n` +
      `Need more? Check *How to Play*.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📖 How to Play", "how_to_play")],
          [Markup.button.callback("🔙 Back to Main Menu", "main_menu")]
        ])
      }
    );
  });

  // Command fallback
  bot.command("help", (ctx) => {
    ctx.reply(
      `ℹ️ *Quick Help*\n\n` +
      `1️⃣ /start → Main Menu\n` +
      `2️⃣ /help → Help Guide\n` +
      `3️⃣ Use buttons for wallet, matches, or bets.\n\n` +
      `Need more help? Use 📖 How to Play.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📖 How to Play", "how_to_play")],
          [Markup.button.callback("🔙 Back to Main Menu", "main_menu")]
        ])
      }
    );
  });
}
