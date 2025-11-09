// =====================================================
// ❌ Cancel Bet Handler — Final Auto-Refresh Version (v3.3)
// =====================================================

import { Markup } from "telegraf";
import { cancelUserBet } from "../../db/db.js";
import { startPreMatchBet } from "./preMatchBetHandler.js";
import { logger } from "../../utils/logger.js";

/**
 * ❌ Handles cancelling a user’s pending bet,
 * fully refreshing odds and UI automatically
 */
export default function cancelBetHandler(bot) {
  bot.action(/cancel_bet_(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    const playIndex = parseInt(ctx.match[1], 10);
    const messageId = ctx.callbackQuery?.message?.message_id;

    logger.info(`❌ [CancelPlay] Triggered | user=${userId} | playIndex=${playIndex}`);

    // 1️⃣ Acknowledge callback
    try {
      await ctx.answerCbQuery("⏳ Cancelling your bet...");
      logger.debug(`✅ [CancelPlay] Callback acknowledged for user=${userId}`);
    } catch (err) {
      logger.warn(`⚠️ [CancelPlay] Callback ack failed: ${err.message}`);
    }

    try {
      // 2️⃣ Cancel the bet in DB
      const result = await cancelUserBet(userId, playIndex);
      logger.debug(`[CancelPlay] cancelUserBet() → ${JSON.stringify(result)}`);

      if (!result.success) {
        logger.error(`💥 [CancelPlay] Failed for ${userId}: ${result.error}`);
        await ctx.reply("⚠️ Could not cancel your play. Please retry shortly.", {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Retry Cancel", `cancel_bet_${playIndex}`)],
            [Markup.button.callback("🎟 View My Plays", "my_plays")],
          ]),
        });
        return;
      }

      // 3️⃣ Clean up previous bet card message
      if (messageId) {
        try {
          await ctx.deleteMessage(messageId);
          logger.debug(`🧹 [CancelPlay] Old bet card deleted | msgId=${messageId}`);
        } catch (err) {
          logger.warn(`⚠️ [CancelPlay] Could not delete old message: ${err.message}`);
        }
      }

      // 4️⃣ Send confirmation message
      const msg =
        `✅ *Your play has been cancelled successfully!*\n\n` +
        `💰 Refunded: *${result.refunded} G*\n` +
        `💳 New Balance: *${result.newBalance} G*\n` +
        `🧾 Bet ID: ${result.playId}\n\n` +
        `♻️ Pool odds recalculated automatically.`;

      await ctx.reply(msg, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🎟 View My Plays", "my_plays")],
          [Markup.button.callback("🏠 Main Menu", "main_menu")],
        ]),
      });

      logger.info(
        `✅ [CancelPlay] Bet cancelled | user=${userId} | bet=${result.playId} | refunded=${result.refunded}`
      );

      // 5️⃣ Refresh odds & redraw pre-match screen
      try {
        logger.debug(`[CancelPlay] Rebuilding PreMatch odds screen for match=${result.match_id}`);
        await startPreMatchBet(ctx, result.match_id); // 🔥 Refresh full odds view
        logger.info(`♻️ [CancelPlay] Odds screen refreshed for match=${result.match_id}`);
      } catch (rebuildErr) {
        logger.warn(`⚠️ [CancelPlay] Odds UI refresh failed: ${rebuildErr.message}`);
      }

      // 6️⃣ Auto-refresh user's My Plays
      try {
        if (bot.myBetsHandler) {
          logger.debug(`[CancelPlay] Triggering My Plays refresh for user=${userId}`);
          await bot.myBetsHandler(ctx);
        }
      } catch (refreshErr) {
        logger.warn(`⚠️ [CancelPlay] My Plays refresh failed: ${refreshErr.message}`);
      }
    } catch (err) {
      // 7️⃣ Catch-all fallback
      logger.error(`💥 [CancelPlay] Uncaught error for ${userId}: ${err.stack}`);
      try {
        await ctx.reply("⚠️ Internal error occurred while cancelling your bet.");
      } catch (replyErr) {
        logger.error(`⚠️ [CancelPlay] Secondary reply failed: ${replyErr.message}`);
      }
    }

    logger.info(`🏁 [CancelPlay] Completed | user=${userId} | playIndex=${playIndex}`);
  });
}
