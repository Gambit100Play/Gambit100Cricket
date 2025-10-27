import { placeBetWithDebit, getMatchById, query } from "../../db/db.js";
import { getPoolInfo, getPoolStatus } from "../../db/poolLogic.js";
import { DateTime } from "luxon";

export default function betHandler(bot) {
  bot.startBet = async (ctx, matchName, betType, betOption, matchId) => {
    console.log(`💰 [startBet] for ${betType} | ${matchName} | ${betOption}`);

    try {
      const match = await getMatchById(matchId);
      if (!match) {
        await ctx.reply("⚠️ Match details not found. Please try again later.");
        return;
      }

      // 🕒 Match start/lock check
      const startTimeUTC = DateTime.fromISO(match.lock_time || match.start_time, {
        zone: "utc",
      });
      if (DateTime.utc() >= startTimeUTC) {
        await ctx.reply("🔒 Betting is closed for this match (match already started).");
        return;
      }

      // 👥 Pool info (for display)
      const pool = await getPoolInfo(matchId, "PreMatch");
      const minNeeded = 10;
      const status = getPoolStatus(pool.participants, minNeeded);
      const remaining = Math.max(minNeeded - pool.participants, 0);

      // 🕒 Time left for betting
      const now = DateTime.utc();
      const diff = startTimeUTC.diff(now, ["minutes", "seconds"]).toObject();
      const mins = Math.floor(diff.minutes);
      const secs = Math.floor(diff.seconds);
      const timeLeftMsg = `⏳ Bet closes in ${mins}m ${secs}s`;

      // 🧠 Context message
      let poolNote =
        status === "pending"
          ? `🚧 *Pool not active yet — your odds will update once pool activates.*\n` +
            `👥 *Players joined:* ${pool.participants}/${minNeeded} (${remaining} more needed)\n\n`
          : "✅ *Pool active — odds are live!*\n\n";

      // Ask for stake
      await ctx.reply(
        `🎯 *${matchName}*\n📊 Market: *${betOption}*\n\n${timeLeftMsg}\n\n${poolNote}` +
          `💰 Enter your stake amount (e.g. 100):`,
        { parse_mode: "Markdown" }
      );

      // Store flow
      ctx.session.betFlow = {
        matchId,
        matchName,
        betType,
        betOption,
        startedAt: Date.now(),
        completed: false,
      };

      setTimeout(() => {
        if (ctx.session?.betFlow && !ctx.session.betFlow.completed) {
          ctx.session.betFlow = null;
          ctx.reply("⌛ Bet input timed out. Please start again if you wish to bet.");
        }
      }, 60000);
    } catch (err) {
      console.error("❌ [startBet] Error:", err.message);
      await ctx.reply("⚠️ Failed to fetch match info. Please try again later.");
    }
  };

  // 💬 Handle stake input
  bot.on("text", async (ctx, next) => {
    if (!ctx.session.betFlow) return next();

    const text = ctx.message.text.trim();
    if (text.startsWith("/") || text.length > 10) return next();

    if (ctx.session.betFlow.completed) {
      await ctx.reply("⚠️ You've already placed this bet. Start a new one if needed.");
      return;
    }

    const stake = Number(text);
    if (isNaN(stake) || stake <= 0) {
      await ctx.reply("⚠️ Please enter a valid positive number as your stake.");
      return;
    }

    const { matchId, matchName, betType, betOption } = ctx.session.betFlow;
    const telegramId = ctx.from.id;

    try {
      const match = await getMatchById(matchId);
      const startTimeUTC = DateTime.fromISO(match.lock_time || match.start_time, {
        zone: "utc",
      });

      if (DateTime.utc() >= startTimeUTC) {
        await ctx.reply("🔒 Sorry, betting is now closed for this match.");
        ctx.session.betFlow = null;
        return;
      }

      // ✅ Place bet regardless of pool status
      const result = await placeBetWithDebit({
        telegramId,
        matchId,
        matchName,
        betType,
        betOption,
        stake,
      });

      const { tokens, bonus_tokens, usdt } = result.balance;

      // 👥 Fetch pool info again
      let pool = await getPoolInfo(matchId, "PreMatch");
      const minNeeded = 10;

      // 🧠 Check if this player was already part of this pool
      const checkRes = await query(
        `SELECT 1 FROM bets WHERE telegram_id = $1 AND match_id = $2 AND LOWER(market_type) = LOWER($3) LIMIT 1`,
        [telegramId, matchId, "PreMatch"]
      );

      // ✅ Only increase if this is their first bet in this match/pool
      const alreadyJoined = checkRes.rowCount > 0;
      if (!alreadyJoined) {
        pool.participants += 1;
      }

      const status = getPoolStatus(pool.participants, minNeeded);
      const remaining = Math.max(minNeeded - pool.participants, 0);

      const poolMsg =
        status === "pending"
          ? `🚧 Pool not active yet — odds will update after ${remaining} more players join.`
          : "✅ Pool active — live odds updating now!";

      await ctx.reply(
        `✅ *Bet Placed Successfully!*\n\n` +
          `🏏 *Match:* ${matchName}\n` +
          `🎯 *Market:* ${betOption}\n` +
          `💰 *Stake:* ${stake} G\n\n` +
          `${poolMsg}\n\n` +
          `📊 *Updated Balance:*\n` +
          `• Tokens: ${tokens}\n` +
          `• Bonus: ${bonus_tokens}\n` +
          `• USDT: ${usdt}`,
        { parse_mode: "Markdown" }
      );

      ctx.session.betFlow.completed = true;
      setTimeout(() => (ctx.session.betFlow = null), 2000);
    } catch (err) {
      console.error("❌ Bet Placement Error:", err.message);
      await ctx.reply(
        err.message.includes("INSUFFICIENT_FUNDS")
          ? "❌ Not enough balance to place this bet."
          : "⚠️ Failed to place bet. Please try again later."
      );
      ctx.session.betFlow = null;
    }

    return next();
  });
}
