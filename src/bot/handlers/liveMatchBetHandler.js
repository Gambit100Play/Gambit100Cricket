// ============================================================
// 🏏 liveMatchBetHandler — Show Active Live Pools + Place Bets
// ============================================================
//
// Purpose:
// • Shows currently active pools from live_pools for a given match
// • Lets users select Over/Under bets
// • Handles stake input + DB debit
// ============================================================

import { Markup } from "telegraf";
import { DateTime } from "luxon";
import { query, getMatchById, placeBetWithDebit } from "../../db/db.js";
import { logger as customLogger } from "../../utils/logger.js";

const logger = customLogger || console;

/* ============================================================
 🕒 Helper — Format UTC → IST
============================================================ */
function formatStartIST(input) {
  if (!input) return "TBA";
  let dt;
  if (input instanceof Date) dt = DateTime.fromJSDate(input);
  else if (typeof input === "string")
    dt = input.includes("T") ? DateTime.fromISO(input) : DateTime.fromSQL(input);
  else if (typeof input === "number") dt = DateTime.fromMillis(input);
  if (!dt || !dt.isValid) return "Invalid Time";
  return dt.setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
}

/* ============================================================
 🏁 Helper — Team Flag Emojis
============================================================ */
function getFlag(teamName = "") {
  const name = teamName.toLowerCase();
  if (name.includes("india")) return "🇮🇳";
  if (name.includes("australia")) return "🇦🇺";
  if (name.includes("england")) return "🏴";
  if (name.includes("pakistan")) return "🇵🇰";
  if (name.includes("bangladesh")) return "🇧🇩";
  if (name.includes("sri lanka")) return "🇱🇰";
  if (name.includes("new zealand")) return "🇳🇿";
  if (name.includes("south africa")) return "🇿🇦";
  if (name.includes("afghanistan")) return "🇦🇫";
  if (name.includes("west indies")) return "🇮🇳🇪🇸";
  if (name.includes("nepal")) return "🇳🇵";
  if (name.includes("usa")) return "🇺🇸";
  return "🏏";
}

/* ============================================================
 🧠 Cache — waiting for stake input per user
============================================================ */
const waitingForStake = new Map();

/* ============================================================
 🎯 Main Handler
============================================================ */
export default function liveMatchBetHandler(bot) {
  /* ============================================================
   📱 Entry — User taps a live match button
  ============================================================ */
  bot.action(/live_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const rawMatchId = ctx.match[1];
    const matchId = parseInt(String(rawMatchId).replace(/^m-/, ""), 10);

    if (isNaN(matchId)) {
      logger.error(`[LiveBetEntry] Invalid matchId: ${rawMatchId}`);
      return ctx.reply("⚠️ Invalid match reference. Please try again.");
    }

    logger.info(`🎯 [LiveBetEntry] user=${ctx.from.id} match=${matchId}`);

    const match = await getMatchById(matchId);
    if (!match) {
      logger.warn(`[LiveBetEntry] Match ${matchId} not found in DB`);
      return ctx.reply("❌ Match not found or has expired.");
    }

    // Extract team info
    let teamA = "Team A";
    let teamB = "Team B";
    try {
      const payload =
        typeof match.api_payload === "object" && match.api_payload !== null
          ? match.api_payload
          : JSON.parse(match.api_payload || "{}");
      teamA = payload?.team1?.teamName || teamA;
      teamB = payload?.team2?.teamName || teamB;
    } catch (err) {
      logger.warn(`⚠️ [LiveBetEntry] Failed to parse api_payload: ${err.message}`);
    }

    const teamAFlag = getFlag(teamA);
    const teamBFlag = getFlag(teamB);
    const status = match.status?.toLowerCase() || "";

    // Not live yet?
    if (!status.includes("live") && !status.includes("in progress")) {
      const when = formatStartIST(match.start_time);
      logger.info(`[LiveBetEntry] Match ${matchId} not yet live.`);
      return ctx.reply(
        `🕓 *${teamAFlag} ${teamA} vs ${teamBFlag} ${teamB}* isn’t live yet.\n📅 Scheduled: ${when} IST`,
        { parse_mode: "Markdown" }
      );
    }

    /* ============================================================
     🔍 Fetch Active Live Pools from DB (Cast to bigint)
    ============================================================ */
    let poolsRes;
    try {
      poolsRes = await query(
        `SELECT id, category, start_over, end_over, threshold
           FROM live_pools
          WHERE matchid = $1::bigint
            AND LOWER(status) = 'active'
          ORDER BY category`,
        [matchId]
      );
      logger.info(`[LiveBetEntry] Found ${poolsRes.rowCount} active pools for match ${matchId}`);
    } catch (err) {
      logger.error(`[LiveBetEntry] DB fetch failed for ${matchId}: ${err.message}`);
      return ctx.reply("⚠️ Could not load live markets.");
    }

    const pools = poolsRes.rows || [];
    if (!pools.length) {
      logger.info(`[LiveBetEntry] No active pools for match ${matchId}`);
      return ctx.reply("📡 No active live pools right now. Check back soon!");
    }

    /* ============================================================
     🎨 Build Dynamic Buttons for Each Category
    ============================================================ */
    const buttons = pools.map((p) => [
      Markup.button.callback(
        `📈 ${p.category.toUpperCase()} Over ${p.threshold}`,
        `live_over_${p.id}`
      ),
      Markup.button.callback(
        `📉 ${p.category.toUpperCase()} ≤ ${p.threshold}`,
        `live_under_${p.id}`
      ),
    ]);
    buttons.push([Markup.button.callback("🔙 Back", "matches")]);

    const scoreInfo = match.score || "Not available";
    const header =
      `🔴 *Live Predictions* — ${teamAFlag} ${teamA} vs ${teamBFlag} ${teamB}\n\n` +
      `📊 *Score:* ${scoreInfo}\n` +
      `🎯 *Active Market Window:* Overs ${pools[0].start_over}-${pools[0].end_over}`;

    await ctx.reply(header, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  /* ============================================================
   🧠 Live Pool Selection — Over/Under
  ============================================================ */
  bot.action(/live_(over|under)_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const direction = ctx.match[1];
    const poolId = ctx.match[2];
    logger.info(`🎯 [LivePoolSelect] user=${ctx.from.id} pool=${poolId} dir=${direction}`);

    try {
      const poolRes = await query(
        `SELECT lp.id, lp.matchid, lp.category, lp.threshold, lp.end_over, m.name
           FROM live_pools lp
           JOIN matches m ON m.match_id = lp.matchid
          WHERE lp.id = $1::integer`,
        [poolId]
      );

      const pool = poolRes.rows[0];
      if (!pool) {
        logger.warn(`[LivePoolSelect] Pool ${poolId} not found or locked.`);
        return ctx.reply("❌ Pool not found or no longer active.");
      }

      const betOption =
        direction === "over"
          ? `Over ${pool.threshold} ${pool.category}`
          : `Under or Equal ${pool.threshold} ${pool.category}`;

      waitingForStake.set(ctx.from.id, {
        matchId: pool.matchid,
        matchName: pool.name,
        poolId,
        betOption,
        betType: "Live",
        marketType: pool.category,
        segmentDuration: pool.end_over,
      });

      await ctx.reply(`🎯 *${betOption}*\n💰 Enter your stake amount (in G-Tokens):`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      logger.error(`[LivePoolSelect] Failed for pool ${poolId}: ${err.message}`);
      ctx.reply("⚠️ Could not fetch live pool. Try again later.");
    }
  });

  /* ============================================================
   💰 Stake Input Handler
  ============================================================ */
  bot.on("text", async (ctx) => {
    const telegramId = ctx.from.id;
    const stakeInfo = waitingForStake.get(telegramId);
    if (!stakeInfo) return;

    const stake = parseFloat(ctx.message.text);
    if (isNaN(stake) || stake <= 0) {
      return ctx.reply("⚠️ Please enter a valid numeric stake amount.");
    }

    try {
      logger.info(
        `💸 [LiveStake] user=${telegramId} match=${stakeInfo.matchId} pool=${stakeInfo.poolId} stake=${stake}`
      );

      const { bet } = await placeBetWithDebit({
        telegramId,
        matchId: stakeInfo.matchId,
        matchName: stakeInfo.matchName,
        betType: stakeInfo.betType,
        betOption: stakeInfo.betOption,
        stake,
        marketType: stakeInfo.marketType,
        segmentDuration: stakeInfo.segmentDuration,
        poolId: stakeInfo.poolId,
      });

      waitingForStake.delete(telegramId);

      await ctx.reply(
        `✅ *Bet Placed Successfully!*\n\n` +
          `🏏 *${stakeInfo.matchName}*\n` +
          `🎯 *${stakeInfo.betOption}*\n` +
          `💸 Stake: *${stake} G-Tokens*\n` +
          `📊 Market: *${stakeInfo.marketType}* (till ${stakeInfo.segmentDuration} overs)\n\n` +
          `Best of luck 🍀 — results after this segment!`,
        { parse_mode: "Markdown" }
      );

      logger.info(
        `✅ [LiveBet] Bet confirmed user=${telegramId} pool=${stakeInfo.poolId} stake=${stake}`
      );
    } catch (err) {
      logger.error(`❌ [LiveBet] Error user=${telegramId}: ${err.message}`);
      ctx.reply("❌ Bet could not be placed. Please try again.");
    }
  });
}
