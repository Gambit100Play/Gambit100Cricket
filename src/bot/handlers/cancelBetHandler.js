// =====================================================
// ❌ Cancel Bet Handler — Final Optimized Version (v3.1)
// =====================================================

import { Markup } from "telegraf";
import { cancelUserBet } from "../../db/db.js";
import { logger } from "../../utils/logger.js";

/**
 * ❌ Handles cancelling a user’s pending bet and refreshing odds + UI
 */
export default function cancelBetHandler(bot) {
  bot.action(/cancel_bet_(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    const playIndex = parseInt(ctx.match[1], 10);
    const messageId = ctx.callbackQuery?.message?.message_id;

    logger.info(`❌ [CancelPlay] Triggered | user=${userId} | playIndex=${playIndex}`);

    // 1️⃣ Acknowledge Telegram callback (avoid “loading...” spinner)
    try {
      await ctx.answerCbQuery("⏳ Cancelling your bet...");
      logger.debug(`✅ [CancelPlay] Callback acknowledged for user=${userId}`);
    } catch (err) {
      logger.warn(`⚠️ [CancelPlay] Callback ack failed for ${userId}: ${err.message}`);
    }

    // 2️⃣ Begin cancellation flow
    try {
      logger.debug(`⚙️ [CancelPlay] Invoking cancelUserBet(${userId}, ${playIndex})...`);
      const result = await cancelUserBet(userId, playIndex);
      logger.debug(`[CancelPlay] cancelUserBet() → ${JSON.stringify(result)}`);

      // 3️⃣ Handle failure conditions
      if (!result.success) {
        logger.error(`💥 [CancelPlay] Failed for ${userId}: ${result.error}`);

        await ctx.reply(
          "⚠️ Could not cancel your play. Please retry shortly.",
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback("🔄 Retry Cancel", `cancel_bet_${playIndex}`)],
              [Markup.button.callback("🎟 View My Plays", "my_plays")],
            ]),
          }
        );
        return;
      }

      // 4️⃣ Remove old “bet card” message for cleaner UX
      if (messageId) {
        try {
          await ctx.deleteMessage(messageId);
          logger.debug(`🧹 [CancelPlay] Old bet card removed | msgId=${messageId}`);
        } catch (err) {
          logger.warn(`⚠️ [CancelPlay] Could not delete old message: ${err.message}`);
        }
      }

      // 5️⃣ Send confirmation message
      const msg =
        `❌ *Your play has been cancelled successfully!*\n\n` +
        `💰 Refunded: *${result.refunded} G*\n` +
        `💳 New Balance: *${result.newBalance} G*\n` +
        `🧾 Bet ID: ${result.playId}\n\n` +
        `♻️ Pool odds have been refreshed automatically.`;

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

      // 6️⃣ Auto-refresh the user’s “My Plays” list (soft reload)
      try {
        if (bot.myBetsHandler) {
          logger.debug(`[CancelPlay] Auto-refreshing My Plays for ${userId}...`);
          await bot.myBetsHandler(ctx);
        }
      } catch (refreshErr) {
        logger.warn(`⚠️ [CancelPlay] Auto-refresh failed: ${refreshErr.message}`);
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
