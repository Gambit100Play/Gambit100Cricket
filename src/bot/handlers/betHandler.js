// ============================================================
// 💰 Bet Handler — handles the "Place Play" confirmation
// ============================================================

import { Markup } from "telegraf";
import {
  getUserBalance,
  updateUserBalance,
  insertUserBet,  // <- make sure this exists in db/db.js
} from "../../db/db.js";
import { logger } from "../../utils/logger.js";

export default function betHandler(bot) {
  logger.info("🧩 [INIT] betHandler module attached.");

  // 💰 When user presses "Place Play (100 G)"
  bot.action("play_confirm_100g", async (ctx) => {
    const userId = ctx.from?.id;
    logger.info(`💰 [PlacePlay] Callback received | user=${userId}`);

    try {
      await ctx.answerCbQuery("💰 Placing your 100 G play...");

      // --- Retrieve pending play from session ---
      const { matchId, marketType, playOption, matchName } =
        ctx.session?.currentPlay || {};

      if (!matchId || !playOption) {
        return ctx.reply("⚠️ No active play found. Please reselect your market.");
      }

      // --- Check user balance ---
      const balance = await getUserBalance(userId);
      if (!balance || balance.tokens < 100) {
        return ctx.reply("❌ Not enough tokens. Deposit or earn more to play!");
      }

      // --- Deduct & insert bet ---
      const newTokens = balance.tokens - 100;
      await Promise.all([
        updateUserBalance(userId, newTokens, balance.bonus_tokens, balance.usdt),
        insertUserBet(userId, matchId, marketType, playOption, 100),
      ]);

      logger.info(
        `✅ [PlacePlay] 100 G bet placed | user=${userId} | match=${matchId} | option=${playOption}`
      );

      // --- Confirmation reply ---
      await ctx.reply(
        `✅ *Play Placed!*\n\n🏏 *${matchName || "Unknown Match"}*\n🎯 ${playOption}\n💰 Stake: 100 G\n\n💳 New Balance: *${newTokens} G*`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🎟 View My Plays", "my_plays")],
            [Markup.button.callback("🏠 Main Menu", "main_menu")],
          ]),
        }
      );
    } catch (err) {
      logger.error(`💥 [PlacePlay] ${err.stack}`);
      await ctx.reply("⚠️ Could not place your play. Please try again.").catch(() => {});
    }
  });
}
