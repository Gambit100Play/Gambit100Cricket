// src/bot/handlers/cancelBetHandler.js
import { Markup } from "telegraf";
import { cancelUserBet } from "../../db/db.js"; // ✅ static import (correct)
import { logger } from "../../utils/logger.js";

/**
 * ❌ Handles cancelling a user’s pending bet
 */
export default function cancelBetHandler(bot) {
  bot.action(/cancel_bet_(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    const playIndex = parseInt(ctx.match[1], 10);

    logger.info(`❌ [CancelPlay] Triggered | user=${userId} | playIndex=${playIndex}`);

    // Step 1️⃣: Acknowledge Telegram callback
    try {
      await ctx.answerCbQuery("Cancelling your bet...");
      logger.debug(`✅ [CancelPlay] Callback acknowledged for user=${userId}`);
    } catch (err) {
      logger.warn(`⚠️ [CancelPlay] Callback ack failed for ${userId}: ${err.message}`);
    }

    // Step 2️⃣: Begin cancellation process
    try {
      logger.debug(`⚙️ [CancelPlay] Invoking cancelUserBet(${userId}, ${playIndex})...`);
      const result = await cancelUserBet(userId, playIndex);
      logger.debug(`[CancelPlay] cancelUserBet() result: ${JSON.stringify(result)}`);

      // Step 3️⃣: Handle failure
      if (!result.success) {
        logger.error(`💥 [CancelPlay] Failed for ${userId}: ${result.error}`);
        await ctx.reply("⚠️ Failed to cancel your play. Please retry shortly.", {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Retry Cancel", `cancel_bet_${playIndex}`)],
            [Markup.button.callback("🎟 View My Plays", "my_plays")],
          ]),
        });
        return;
      }

      // Step 4️⃣: Success → Refund message
      logger.info(
        `✅ [CancelPlay] Bet cancelled successfully | user=${userId} | bet=${result.playId} | refunded=${result.refunded} | newBalance=${result.newBalance}`
      );

      const msg =
        `❌ *Play #${playIndex + 1}* cancelled and *${result.refunded} G* refunded.\n\n` +
        `💰 *Tokens:* ${result.newBalance} G\n` +
        `🧾 Bet ID: ${result.playId}`;

      await ctx.reply(msg, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🎟 View My Plays", "my_plays")],
          [Markup.button.callback("🏠 Main Menu", "main_menu")],
        ]),
      });

      // Step 5️⃣: Auto-refresh My Plays
      try {
        if (bot.myBetsHandler) {
          logger.debug(`[CancelPlay] Auto-refreshing plays for ${userId}...`);
          await bot.myBetsHandler(ctx);
        }
      } catch (refreshErr) {
        logger.warn(
          `⚠️ [CancelPlay] Auto-refresh failed for ${userId}: ${refreshErr.message}`
        );
      }
    } catch (err) {
      // Step 6️⃣: Unexpected fatal error
      logger.error(`💥 [CancelPlay] Uncaught error for ${userId}: ${err.stack}`);
      try {
        await ctx.reply("⚠️ Internal error occurred while cancelling your bet.");
      } catch (replyErr) {
        logger.error(
          `⚠️ [CancelPlay] Secondary reply failed for ${userId}: ${replyErr.message}`
        );
      }
    }

    logger.info(`🏁 [CancelPlay] Ended | user=${userId} | playIndex=${playIndex}`);
  });
}
