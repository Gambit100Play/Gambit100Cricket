// src/bot/handlers/myBetsHandler.js
import { Markup } from "telegraf";
import { getUserBets } from "../../db/db.js";
import { logger } from "../../utils/logger.js";
import cancelBetHandler from "./cancelBetHandler.js"; // ✅ delegate cancel logic

/**
 * 🎟 Handles displaying and managing user's active and past plays (bets)
 */
export default function myBetsHandler(bot) {
  logger.info("🧩 [INIT] myBetsHandler module loaded and attached.");

  /* ============================================================
     🎯 View My Plays (via Callback)
  ============================================================ */
  bot.action(["my_bets", "my_plays"], async (ctx) => {
    const userId = ctx.from?.id;
    logger.info(`🎟 [MyBets] Callback triggered | user=${userId}`);

    try {
      await ctx.answerCbQuery("🎟 Fetching your plays...");
      logger.debug(`✅ [MyBets] Callback acknowledged for ${userId}`);
    } catch (err) {
      logger.warn(`⚠️ [MyBets] Could not answer callback query: ${err.message}`);
    }

    try {
      logger.debug(`🚀 [MyBets] Delegating to bot.myBetsHandler() for ${userId}`);
      await bot.myBetsHandler(ctx);
      logger.debug(`✅ [MyBets] Delegation finished for ${userId}`);
    } catch (err) {
      logger.error(`💥 [MyBets] Delegation failed: ${err.stack}`);
      await ctx.reply("⚠️ Could not load your plays. Please try again later.").catch(() => {});
    }
  });

  /* ============================================================
     ❌ Cancel a Pending Play — delegated
  ============================================================ */
  // cancelBetHandler(bot); // ✅ plug in external cancel logic

  /* ============================================================
     🌐 Delegation Function — Main Logic
  ============================================================ */
  bot.myBetsHandler = async (ctx) => {
    const userId = ctx.from?.id;
    const start = new Date().toISOString();
    logger.info(`📲 [myBetsHandler] START | user=${userId} | time=${start}`);

    // Telegram MarkdownV2 escape helper
    const esc = (t = "") =>
      String(t).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

    try {
      logger.debug(`⚙️ [myBetsHandler] Step 1 → getUserBets(${userId})`);
      const startDb = Date.now();

      const plays = await Promise.race([
        (async () => {
          logger.debug("⏳ [myBetsHandler] Entering getUserBets...");
          const data = await getUserBets(userId);
          logger.debug(
            `✅ [myBetsHandler] getUserBets resolved in ${Date.now() - startDb} ms`
          );
          return data;
        })(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("DB call timeout (6 s)")), 6000)
        ),
      ]);

      logger.debug(`📦 [myBetsHandler] Step 1 done → ${plays?.length || 0} records`);

      if (!plays?.length) {
        await ctx.reply(`🎟 *My Plays*\n\nYou haven’t joined any plays yet.`, {
          parse_mode: "MarkdownV2",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("📅 View Matches", "matches")],
            [Markup.button.callback("🏠 Main Menu", "main_menu")],
          ]),
        });
        return;
      }

      logger.debug(`🧮 [myBetsHandler] Step 2 → Sending ${plays.length} cards`);

      for (let i = 0; i < plays.length; i++) {
        const p = plays[i];
        const status = esc(p.status || "Pending");
        const match = esc(p.match_name || "Unknown Match");
        const opt = esc(p.bet_option || "?");
        const type = esc(p.bet_type || "?");
        const stake = esc(String(p.stake || 0));
        const playNum = esc(`#${i + 1}`);

        const text =
          `🎟 *Play ${playNum}*\n\n` +
          `🏏 *${match}*\n` +
          `🎯 ${opt} \\| ${type}\n` +
          `💰 Stake: ${stake} G\n` +
          `📌 Status: *${status}*`;

        const keyboard =
          p.status === "Pending"
            ? Markup.inlineKeyboard([
                [Markup.button.callback(`❌ Cancel Bet ${i + 1}`, `cancel_bet_${i}`)],
              ])
            : Markup.inlineKeyboard([]);

        logger.debug(`💬 [myBetsHandler] Sending card ${i + 1}/${plays.length}`);
        await ctx.reply(text, { parse_mode: "MarkdownV2", ...keyboard });
        await new Promise((r) => setTimeout(r, 400));
      }

      await ctx.reply("🏠 Return to Main Menu", {
        ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "main_menu")]]),
      });

      logger.info(
        `✅ [myBetsHandler] Completed sending ${plays.length} cards | user=${userId}`
      );
    } catch (err) {
      logger.error(`💥 [myBetsHandler] ${err.stack}`);
      await ctx.reply("⚠️ Failed to load your plays. Please try again later.").catch(() => {});
    } finally {
      const end = new Date().toISOString();
      logger.info(`⏱️ [myBetsHandler] END | user=${userId} | time=${end}`);
    }
  };
}
