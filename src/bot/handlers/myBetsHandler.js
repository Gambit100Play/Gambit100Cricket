// ============================================================
// 🎟 myBetsHandler — Displays User Plays (Unified)
// ============================================================
//
// • Shows ALL bets (PreMatch + Live)
// • Uses MarkdownV2 safe formatting
// • Supports cancel buttons for pending bets
// • Works with unified betHandler.js & new DB format
// ============================================================

import { Markup } from "telegraf";
import { getUserBets } from "../../db/db.js";
import { logger } from "../../utils/logger.js";
import cancelBetHandler from "./cancelBetHandler.js"; // optional

export default function myBetsHandler(bot) {
  logger.info("🧩 [INIT] myBetsHandler attached.");

  // ============================================================
  // 🎯 Callback Entry — "My Plays"
  // ============================================================
  bot.action(["my_bets", "my_plays"], async (ctx) => {
    const userId = ctx.from?.id;
    logger.info(`🎟 [MyPlays] Triggered by user=${userId}`);

    try {
      await ctx.answerCbQuery("🎟 Loading your plays...");
    } catch {}

    try {
      await bot.myBetsHandler(ctx);
    } catch (err) {
      logger.error(`💥 [MyPlays] Failed: ${err.stack}`);
      await ctx.reply("⚠️ Could not load your plays. Try again.").catch(() => {});
    }
  });

  // ============================================================
  // 🌐 Main Logic — Fetch + Render Plays
  // ============================================================
  bot.myBetsHandler = async (ctx) => {
    const userId = ctx.from?.id;
    logger.info(`📲 [myBetsHandler] START | user=${userId}`);

    // Escape MarkdownV2 safely
    const esc = (t = "") =>
      String(t).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

    try {
      // ----------------------------------------------
      // Step 1: Fetch user bets with timeout safeguard
      // ----------------------------------------------
      const startDb = Date.now();
      const plays = await Promise.race([
        (async () => {
          logger.debug("⏳ Fetching user bets...");
          const data = await getUserBets(userId);
          logger.debug(
            `📦 getUserBets resolved in ${Date.now() - startDb} ms`
          );
          return data;
        })(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("DB call timeout (6 s)")), 6000)
        ),
      ]);

      // ----------------------------------------------
      // Step 2: No plays found
      // ----------------------------------------------
      if (!plays?.length) {
        await ctx.reply(
          `🎟 *My Plays*\n\nYou have no plays yet.`,
          {
            parse_mode: "MarkdownV2",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("📅 View Matches", "matches")],
              [Markup.button.callback("🏠 Main Menu", "main_menu")],
            ]),
          }
        );
        return;
      }

      // ----------------------------------------------
      // Step 3: Render each play card
      // ----------------------------------------------
      logger.info(`📄 Rendering ${plays.length} bet cards`);

      for (let i = 0; i < plays.length; i++) {
        const p = plays[i];

        const matchName = esc(p.match_name || "Unknown Match");
        const option = esc(p.bet_option || "?");
        const betType = esc(p.bet_type || "Unknown"); // "PreMatch" or "Live"
        const marketType = esc(p.market_type || "?"); // "Score", "Wickets", etc.
        const stake = esc(String(p.stake || 0));
        const status = esc(p.status || "Pending");

        const card =
          `🎟 *Play #${i + 1}*\n\n` +
          `🏏 *${matchName}*\n` +
          `🎯 ${option}\n` +
          `📊 Market: *${marketType}* | Type: *${betType}*\n` +
          `💰 Stake: ${stake} G\n` +
          `📌 Status: *${status}*`;

        const keyboard =
          p.status === "Pending"
            ? Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    `❌ Cancel Bet ${i + 1}`,
                    `cancel_bet_${i}`
                  ),
                ],
              ])
            : Markup.inlineKeyboard([]);

        await ctx.reply(card, {
          parse_mode: "MarkdownV2",
          ...keyboard,
        });

        await new Promise((r) => setTimeout(r, 350)); // smoother UX
      }

      // ----------------------------------------------
      // Footer button
      // ----------------------------------------------
      await ctx.reply("🏠 Return to Main Menu", {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🏠 Main Menu", "main_menu")],
        ]),
      });

      logger.info(`✅ [myBetsHandler] FINISHED | user=${userId}`);
    } catch (err) {
      logger.error(`💥 [myBetsHandler] ${err.stack}`);
      await ctx.reply("⚠️ Failed to load your plays. Please try again later.").catch(() => {});
    }
  };

  // Optional: plug in cancel logic
  cancelBetHandler(bot);
}
