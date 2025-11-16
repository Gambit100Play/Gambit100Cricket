//
// ============================================================

import { Markup } from "telegraf";
import { query, getMatchById } from "../../db/db.js";
import { logger as customLogger } from "../../utils/logger.js";
import { rateLimit } from "../../redis/rateLimit.js";   // ← ⭐ ADDED

const logger = customLogger || console;

/* ------------------------------------------------------------
 🏁 Flag Helper
------------------------------------------------------------ */
function getFlag(team = "") {
  const t = team.toLowerCase();
  if (t.includes("india")) return "🇮🇳";
  if (t.includes("south africa")) return "🇿🇦";
  if (t.includes("australia")) return "🇦🇺";
  if (t.includes("england")) return "🏴";
  if (t.includes("pakistan")) return "🇵🇰";
  if (t.includes("bangladesh")) return "🇧🇩";
  if (t.includes("sri lanka")) return "🇱🇰";
  if (t.includes("new zealand")) return "🇳🇿";
  if (t.includes("west indies")) return "🇮🇳🇪🇸";
  return "🏏";
}

/* ------------------------------------------------------------
 🎯 MAIN HANDLER
------------------------------------------------------------ */
export default function liveMatchBetHandler(bot) {
  // ------------------------------------------------------------
  // 📌 User taps a live match — "live_<matchId>"
  // ------------------------------------------------------------
  bot.action(/^live_(\d+)$/, async (ctx) => {
    const userId = ctx.from.id;

    // ⭐ Apply rate limit: max 3 requests per 5 seconds
    const allowed = await rateLimit(`live_menu:${userId}`, 3, 5);
    if (!allowed)
      return ctx.answerCbQuery("⏳ Slow down… processing live data.", { show_alert: false });

    await ctx.answerCbQuery();

    const matchId = parseInt(ctx.match[1]);
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found.");

    let teamA = match.team1;
    let teamB = match.team2;

    try {
      const payload =
        typeof match.api_payload === "object"
          ? match.api_payload
          : JSON.parse(match.api_payload || "{}");

      teamA = payload?.team1?.teamName || teamA;
      teamB = payload?.team2?.teamName || teamB;
    } catch {}

    const flagA = getFlag(teamA);
    const flagB = getFlag(teamB);

    await ctx.reply(
      `🔴 *Live Predictions*\n${flagA} *${teamA}* vs ${flagB} *${teamB}*`,
      { parse_mode: "Markdown" }
    );

    // ------------------------------------------------------------
    // 🗂 Fetch latest pool per category
    // ------------------------------------------------------------
    const { rows: pools } = await query(
      `
      SELECT DISTINCT ON (category)
        id, category, start_over, end_over, threshold, options
      FROM live_pools
      WHERE matchid=$1 AND LOWER(status)='active'
      ORDER BY category, end_over DESC
      `,
      [matchId]
    );

    if (!pools.length)
      return ctx.reply("📡 No live prediction markets are available right now.");

    // ------------------------------------------------------------
    // 🎛 Render each prediction card
    // ------------------------------------------------------------
    for (const p of pools) {
      const cat = p.category.toLowerCase();

      const question =
        cat === "score"
          ? `🏏 *Predicted Runs by Over ${p.end_over}?*`
          : cat === "wickets"
          ? `🎯 *Total Wickets Fallen by Over ${p.end_over}?*`
          : cat === "boundaries"
          ? `💥 *Total Boundaries Hit by Over ${p.end_over}?*`
          : `📊 *Prediction Market:* ${p.category}`;

      // ------------------------------------------------------------
      // 🧩 Snapshot logic (current or fallback)
      // ------------------------------------------------------------
      let snapshot = "📊 *Current:* Not available";

      try {
        const opt =
          typeof p.options === "object" ? p.options : JSON.parse(p.options || "{}");

        if (
          opt.current_runs != null &&
          opt.current_wickets != null &&
          opt.current_over != null
        ) {
          const runs = opt.current_runs;
          const wkts = opt.current_wickets;
          const ov = opt.current_over;

          snapshot =
            `📊 *Current:* ${runs}/${wkts} in ${ov} overs\n` +
            `🔥 *Run Rate:* ${(runs / (Number(ov) || 1)).toFixed(2)} RPO`;
        }

        if (snapshot.includes("Not available")) {
          const last = opt?.last_five_over_stats;
          if (last && typeof last === "object") {
            snapshot =
              `📊 *Current:* ${last.runs ?? 0}/${last.wickets ?? 0} (last 5 overs)\n` +
              `💥 Boundaries: ${last.boundaries ?? 0}`;
          }
        }
      } catch (err) {
        logger.warn(`⚠️ Snapshot parse error: ${err.message}`);
      }

      const unit =
        cat === "score" ? "runs" :
        cat === "wickets" ? "wickets" :
        cat === "boundaries" ? "boundaries" : "";

      const msg =
        `${question}\n\n` +
        `${snapshot}\n\n` +
        `🎯 *Threshold:* ${p.threshold} ${unit}`;

      await ctx.reply(msg, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `📈 > ${p.threshold} ${unit}`,
              `live_over_${p.id}`
            ),
            Markup.button.callback(
              `📉 ≤ ${p.threshold} ${unit}`,
              `live_under_${p.id}`
            )
          ]
        ])
      });
    }

    await ctx.reply("⬅️ Back", {
      ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "matches")]])
    });
  });

  // ------------------------------------------------------------
  // 🧠 Over / Under selection → Save pending bet
  // ------------------------------------------------------------
  bot.action(/live_(over|under)_(\d+)/, async (ctx) => {
    const userId = ctx.from.id;

    // ⭐ Allow maximum 4 over/under selections per 6s
    const allowed = await rateLimit(`live_option:${userId}`, 4, 6);
    if (!allowed)
      return ctx.answerCbQuery("⏳ Too many selections… please wait.", {
        show_alert: false,
      });

    await ctx.answerCbQuery();

    const sel = ctx.match[1];
    const poolId = ctx.match[2];

    const { rows } = await query(
      `
      SELECT lp.*, m.name
      FROM live_pools lp
      JOIN matches m ON m.match_id = lp.matchid
      WHERE lp.id=$1
      `,
      [poolId]
    );

    const p = rows[0];
    if (!p) return ctx.reply("❌ Market no longer available.");

    const chosen =
      sel === "over"
        ? `> ${p.threshold} ${p.category}`
        : `≤ ${p.threshold} ${p.category}`;

    ctx.session.currentPlay = {
      matchId: p.matchid,
      matchName: p.name,
      marketType: p.category,
      playOption: chosen,
      start_over: p.start_over,
      end_over: p.end_over,
      segmentDuration: p.end_over,
      poolId,
      stake: 100,
      betType: "Live",
      createdAt: Date.now(),
    };

    return ctx.reply(
      `🎯 *${chosen}*\n🕒 By Over *${p.end_over}*\n\n` +
        `💰 Tap below to confirm your 100 G play:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Confirm Play (100 G)", "play_confirm_100g")],
          [Markup.button.callback("❌ Cancel", "cancel_play")],
        ])
      }
    );
  });
}