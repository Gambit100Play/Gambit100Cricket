// src/bot/handlers/myBetsHandler.js
import { Markup } from "telegraf";
import {
  getUserBets,
  getUserBalance,
  updateBetStatus,
  updateUserBalance,
} from "../../db/db.js";
import { logger } from "../../utils/logger.js";

/**
 * 🎟 Handles displaying and managing user's active and past plays (bets)
 */
export default function myBetsHandler(bot) {
  logger.info("🧩 [INIT] myBetsHandler module attached.");

  /* ============================================================
     🎯 View My Plays (Callback Entry Point)
  ============================================================ */
  bot.action(["my_bets", "my_plays"], async (ctx) => {
    const userId = ctx.from?.id;
    logger.info(`🎟 [MyBets] Callback triggered | user=${userId}`);

    try {
      await ctx.answerCbQuery("🎟 Fetching your plays...");
      logger.debug(`✅ [MyBets] Callback answered for ${userId}`);
    } catch (err) {
      logger.warn(`⚠️ [MyBets] Could not answer callback query: ${err.message}`);
    }

    try {
      logger.debug(`🚀 [MyBets] Delegating to bot.myBetsHandler() for ${userId}`);
      await bot.myBetsHandler(ctx);
    } catch (err) {
      logger.error(`💥 [MyBets] Delegation failed: ${err.stack}`);
      await ctx.reply("⚠️ Could not load your plays. Please try again later.").catch(() => {});
    }
  });

  /* ============================================================
     ❌ Cancel a Pending Play
  ============================================================ */
  bot.action(/cancel_bet_(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    const playIndex = parseInt(ctx.match[1], 10);
    logger.info(`❌ [CancelPlay] Triggered | user=${userId} | playIndex=${playIndex}`);

    try {
      await ctx.answerCbQuery("Cancelling...");
    } catch (err) {
      logger.warn(`⚠️ [CancelPlay] Callback ack failed: ${err.message}`);
    }

    try {
      const plays = await getUserBets(userId);
      if (!plays?.length) return ctx.reply("⚠️ No plays found in your account.");

      const play = plays[playIndex];
      if (!play) return ctx.reply("⚠️ Could not find this play.");

      if (play.status !== "Pending") {
        return ctx.reply("❌ This play cannot be cancelled once active or completed.");
      }

      // Prevent double refund if race condition occurs
      logger.debug(`💰 [CancelPlay] Fetching balance for ${userId}`);
      const balance = await getUserBalance(userId);
      const newTokens = balance.tokens + play.stake;

      await Promise.all([
        updateUserBalance(userId, newTokens, balance.bonus_tokens, balance.usdt),
        updateBetStatus(play.id, "Cancelled", { reason: "User cancelled manually" }),
      ]);

      logger.info(`✅ [CancelPlay] Refunded ${play.stake} G | user=${userId}`);

      await ctx.reply(
        `❌ Play #${playIndex + 1} cancelled and *${play.stake} G* refunded.\n\n` +
          `💰 Tokens: ${newTokens} G\n🎁 Bonus: ${balance.bonus_tokens} G`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🎟 View My Plays", "my_plays")],
            [Markup.button.callback("🏠 Main Menu", "main_menu")],
          ]),
        }
      );
    } catch (err) {
      logger.error(`💥 [CancelPlay] ${err.stack}`);
      await ctx.reply("⚠️ Failed to cancel your play. Please retry shortly.").catch(() => {});
    }
  });

  /* ============================================================
     🌐 Delegation Function — Main Logic
     Sends one card per bet with Cancel buttons
  ============================================================ */
  bot.myBetsHandler = async (ctx) => {
    const userId = ctx.from?.id;
    logger.info(`📲 [myBetsHandler] START | user=${userId}`);

    // Telegram MarkdownV2 escape (strict)
    const esc = (t = "") =>
      t.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&").trim();

    try {
      logger.debug(`⚙️ [myBetsHandler] Step 1 → Fetching bets from DB`);
      const plays = await getUserBets(userId);
      logger.debug(`📦 [myBetsHandler] Step 1 done → ${plays?.length || 0} records`);

      if (!plays?.length) {
        logger.info(`📭 [myBetsHandler] No plays for user=${userId}`);
        await ctx.reply(`🎟 *My Plays*\n\nYou haven’t joined any plays yet.`, {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("📅 View Matches", "matches")],
            [Markup.button.callback("🏠 Main Menu", "main_menu")],
          ]),
        });
        return;
      }

      logger.debug(`🧮 [myBetsHandler] Step 2 → Preparing cards`);

      const MAX_PER_MESSAGE = 5; // group to avoid too many API calls
      for (let i = 0; i < plays.length; i += MAX_PER_MESSAGE) {
        const chunk = plays.slice(i, i + MAX_PER_MESSAGE);
        const text = chunk
          .map((p, j) => {
            const idx = i + j + 1;
            const status = esc(p.status || "Pending");
            const match = esc(p.match_name || "Unknown Match");
            const opt = esc(p.bet_option || "?");
            const type = esc(p.bet_type || "?");
            return (
              `#${idx} — *${match}*\n🎯 ${opt} | ${type}\n💰 Stake: ${p.stake || 0} G\n📌 Status: *${status}*`
            );
          })
          .join("\n\n");

        const keyboard = Markup.inlineKeyboard([
          ...chunk
            .filter((p) => p.status === "Pending")
            .map((p, j) => [
              Markup.button.callback(`❌ Cancel Bet #${i + j + 1}`, `cancel_bet_${i + j}`),
            ]),
        ]);

        logger.debug(
          `💬 [myBetsHandler] Sending plays ${i + 1}–${i + chunk.length} of ${
            plays.length
          } to ${userId}`
        );

        await ctx.reply(`🎟 *My Plays*\n\n${text}`, {
          parse_mode: "MarkdownV2",
          ...keyboard,
        });

        await new Promise((r) => setTimeout(r, 300));
      }

      await ctx.reply("🏠 Return to Main Menu", {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🏠 Main Menu", "main_menu")],
        ]),
      });

      logger.info(`✅ [myBetsHandler] Completed sending ${plays.length} plays | user=${userId}`);
    } catch (err) {
      logger.error(`💥 [myBetsHandler] Error: ${err.stack}`);
      await ctx.reply("⚠️ Failed to load your plays. Please try again later.").catch(() => {});
    } finally {
      logger.info(`⏱️ [myBetsHandler] END | user=${userId}`);
    }
  };
}
