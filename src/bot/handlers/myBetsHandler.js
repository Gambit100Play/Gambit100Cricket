// src/bot/handlers/myBetsHandler.js
import { Markup } from "telegraf";
import {
  getUserBets,
  getUserBalance,
  updateBetStatus,
  updateUserBalance,
} from "../../db/db.js";

/**
 * 🎟 Handles displaying and managing user's bets.
 */
export default function myBetsHandler(bot) {
  // 🧩 Show all bets
  bot.action("my_bets", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;

    // Fetch bets from DB
    const bets = await getUserBets(userId);

    if (!bets?.length) {
      return ctx.reply(
        `🎟 *My Bets*\n\nYou don’t have any bets yet.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("📅 Predict Now", "matches")],
            [Markup.button.callback("🔙 Back to Main Menu", "main_menu")],
          ]),
        }
      );
    }

    // Format bets
    const betList = bets
      .map(
        (b, i) =>
          `#${i + 1} — *${b.match_name}*\n` +
          `🎲 ${b.bet_option} | ${b.bet_type}\n` +
          `💰 Stake: ${b.stake} G\n` +
          `📌 Status: ${b.status}`
      )
      .join("\n\n");

    await ctx.reply(
      `🎟 *My Bets*\n\n${betList}`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back to Main Menu", "main_menu")],
        ]),
      }
    );
  });

  // 🧩 Cancel bet
  bot.action(/cancel_bet_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const betIndex = parseInt(ctx.match[1], 10);

    const bets = await getUserBets(userId);
    const bet = bets[betIndex];
    if (!bet) {
      return ctx.reply("⚠️ Could not find this bet.");
    }

    if (bet.status !== "Pending") {
      return ctx.reply("❌ This bet cannot be cancelled.");
    }

    // Refund stake to user's balance
    const balance = await getUserBalance(userId);
    const newTokens = balance.tokens + bet.stake;

    await updateUserBalance(userId, newTokens, balance.bonus_tokens, balance.usdt);
    await updateBetStatus(bet.id, "Cancelled", { reason: "User cancelled manually" });

    await ctx.reply(
      `❌ Bet #${betIndex + 1} cancelled and *${bet.stake} G* refunded.\n\n` +
        `🎟 Tokens: ${newTokens} G\n` +
        `🎁 Bonus: ${balance.bonus_tokens} G`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🎟 My Bets", "my_bets")],
          [Markup.button.callback("🔙 Back to Main Menu", "main_menu")],
        ]),
      }
    );
  });
}
