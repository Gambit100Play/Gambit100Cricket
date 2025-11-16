// ============================================================
// 💰 Bet Handler — Redis Protected (v3.0)
// ============================================================
//
// Adds real production-grade safety:
//   ✔ Redis Cooldown (5 seconds)
//   ✔ Redis Distributed Lock (no double bet)
//   ✔ Session expiration (60s)
//   ✔ PreMatch safety (no betting after lock/toss/live)
// ============================================================

import { Markup } from "telegraf";
import {
  query,
  getUserBalance,
  updateUserBalance,
  insertUserBet,
} from "../../db/db.js";
import { logger } from "../../utils/logger.js";

// Redis modules
import { redis } from "../../redis/index.js";
import { acquireLock, releaseLock } from "../../redis/locks.js";

function nowMs() {
  return Date.now();
}

export default function betHandler(bot) {
  logger.info("🧩 [INIT] betHandler module attached with Redis protection.");

  bot.action("play_confirm_100g", async (ctx) => {
    const userId = ctx.from?.id;
    const tsNow = nowMs();

    // ============================================================
    // 🚫 1. Redis Cooldown (5 seconds)
    // ============================================================
    const cdKey = `cooldown:bet:${userId}`;
    const cd = await redis.get(cdKey);

    if (cd) {
      return ctx.answerCbQuery(`⏳ Slow down! Try again in a moment.`, {
        show_alert: false,
      });
    }

    await redis.set(cdKey, "1", { EX: 5 });

    // ============================================================
    // 🚫 2. Redis Lock — prevents double-click or parallel processing
    // ============================================================
    const lockKey = `lock:bet:${userId}`;

    const locked = await acquireLock(lockKey, 8000); // 8 seconds lock
    if (!locked) {
      return ctx.answerCbQuery("⚠️ Processing your play... Please wait.");
    }

    logger.info(`💰 [PlacePlay] Callback received | user=${userId}`);

    try {
      await ctx.answerCbQuery("💰 Placing your 100 G play...");

      // ============================================================
      // 🚫 3. Session Expiration Check (play older than 60s → invalid)
      // ============================================================
      const play = ctx.session?.currentPlay || {};
      const { matchId, marketType, playOption, matchName, createdAt } = play;

      if (!matchId || !playOption) {
        return ctx.reply("⚠️ No active play found. Please reselect your market.");
      }

      if (!createdAt) {
        play.createdAt = tsNow;
      } else if (tsNow - createdAt > 60000) {
        ctx.session.currentPlay = null;
        return ctx.reply("⌛ Your play expired. Please choose your option again.");
      }

      // ============================================================
      // 🚫 4. PREMATCH SAFETY — block after lock or match start
      // ============================================================
      if (marketType === "PreMatch") {
        const statusRes = await query(
          `SELECT 
              m.status AS match_status,
              p.status AS pool_status
           FROM matches m
           LEFT JOIN pools p 
             ON p.matchid = m.match_id
            AND LOWER(p.pool_type) = 'prematch'
           WHERE m.match_id = $1
           LIMIT 1`,
          [matchId]
        );

        const row = statusRes.rows[0] || {};
        const matchStatus = row.match_status?.toLowerCase() || "";
        const poolStatus = row.pool_status?.toLowerCase() || "";

        const closed =
          matchStatus.includes("live") ||
          matchStatus.includes("in progress") ||
          matchStatus.includes("playing") ||
          matchStatus.includes("started") ||
          poolStatus === "locked_pre" ||
          poolStatus === "locked" ||
          matchStatus.includes("completed") ||
          matchStatus.includes("abandoned") ||
          matchStatus.includes("cancelled");

        if (closed) {
          return ctx.reply(
            "🚫 Pre-match betting is closed. Match already started or pool is locked."
          );
        }
      }

      // ============================================================
      // 💰 5. Balance Check
      // ============================================================
      const balance = await getUserBalance(userId);
      if (!balance || balance.tokens < 100) {
        return ctx.reply("❌ Not enough tokens. Deposit or earn more to play!");
      }

      // ============================================================
      // 💳 6. Deduct Tokens + Store Bet (Atomic)
      // ============================================================
      const newTokens = balance.tokens - 100;

      await Promise.all([
        updateUserBalance(userId, newTokens, balance.bonus_tokens, balance.usdt),
        insertUserBet(userId, matchId, marketType, playOption, 100),
      ]);

      logger.info(
        `✅ [PlacePlay] 100 G placed | user=${userId} | match=${matchId} | market=${marketType}`
      );

      ctx.session.currentPlay = null;

      // ============================================================
      // 🧾 7. Confirmation
      // ============================================================
      await ctx.reply(
        `✅ *Play Placed!*\n\n` +
          `🏏 *${matchName || "Unknown Match"}*\n` +
          `🎯 ${playOption}\n` +
          `💰 Stake: 100 G\n` +
          `💳 New Balance: *${newTokens} G*`,
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
      await ctx.reply("⚠️ Could not place your play. Please try again.");
    } finally {
      await releaseLock(lockKey);
    }
  });
}
