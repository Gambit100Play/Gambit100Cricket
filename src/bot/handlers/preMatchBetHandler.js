// ============================================================
// 🏏 Pre-Match Bet Handler — Unified with betHandler (v3.7)
// ============================================================
//
// ✔ Stores pending bet in ctx.session.currentPlay
// ✔ Uses unified "play_confirm_100g" button
// ✔ Uses same stake model as LiveMatchBetHandler
// ✔ Modular + safe — betting logic lives only in betHandler.js
// ============================================================

import { Markup } from "telegraf";
import { DateTime } from "luxon";
import { getMatchById, getDynamicOdds, query } from "../../db/db.js";
import { getPoolInfo } from "../../db/poolLogic.js";
import { logger } from "../../utils/logger.js";


global.matchIdMap = global.matchIdMap || new Map();

/* ------------------------------------------------------------
 🕒 Format UTC → IST
------------------------------------------------------------ */
function formatStartIST(input) {
  try {
    if (!input) return "TBA";
    const dt =
      input instanceof Date
        ? DateTime.fromJSDate(input)
        : typeof input === "number"
        ? DateTime.fromMillis(input)
        : DateTime.fromISO(input.includes("T") ? input : input.replace(" ", "T"));

    return dt.setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  } catch {
    return "Invalid Time";
  }
}

/* ------------------------------------------------------------
 🧩 Build Pre-Match Screen
------------------------------------------------------------ */
async function buildPreMatchScreen(ctx, matchId) {
  const match = await getMatchById(matchId);
  if (!match) return ctx.reply("❌ Match not found in database.");

  // Parse payload safely
  let payload = {};
  try {
    payload =
      typeof match.api_payload === "object"
        ? match.api_payload
        : JSON.parse(match.api_payload || "{}");
  } catch {
    payload = {};
  }

  const teamA = payload?.team1?.teamName || match.team1 || "Team A";
  const teamB = payload?.team2?.teamName || match.team2 || "Team B";
  const venue = payload?.venueInfo?.ground || match.venue || "Unknown Ground";
  const when = formatStartIST(match.start_time);

  // Retrieve pool info
  const pool = await getPoolInfo(matchId, "PreMatch");

  // Count unique placed bets (for unlocking odds)
  const distinctRes = await query(
    `SELECT COUNT(DISTINCT LOWER(TRIM(bet_option))) AS unique_plays
       FROM bets
      WHERE match_id=$1
        AND LOWER(market_type)=LOWER($2)
        AND status NOT IN ('Cancelled','Voided')`,
    [matchId, "PreMatch"]
  );

  const uniquePlays = Number(distinctRes.rows[0]?.unique_plays || 0);
  const status = uniquePlays >= 3 ? "active" : "pending";
  const locked = pool?.status === "locked";

  // Compute odds only if pool is active
  let oddsData = [];
  if (status === "active") {
    oddsData = await getDynamicOdds(matchId, "PreMatch");
  }

  const odds = Object.fromEntries(
    (oddsData || []).map((o) => [o.bet_option.toLowerCase(), o.odds])
  );

  const showOdds = (opt) => {
    if (status !== "active") return "";
    const val = odds[opt.toLowerCase()];
    return val ? ` (${val}x)` : "";
  };

  // Create shortId for safe callback-data
  const shortId = String(matchId).slice(0, 8);
  global.matchIdMap.set(shortId, matchId);

  // UI Buttons
  const buttons = locked
    ? [[Markup.button.callback("🔒 Predictions Locked", "noop_locked")]]
    : [
        [
          Markup.button.callback(
            `🏆 ${teamA}${showOdds(`${teamA} to Win`)}`,
            `play_prematch|${shortId}|${encodeURIComponent(`${teamA} to Win`)}`
          ),
          Markup.button.callback(
            `🏆 ${teamB}${showOdds(`${teamB} to Win`)}`,
            `play_prematch|${shortId}|${encodeURIComponent(`${teamB} to Win`)}`
          ),
        ],
        [
          Markup.button.callback(
            `🤝 Draw / Tie${showOdds("Draw / Tie")}`,
            `play_prematch|${shortId}|${encodeURIComponent("Draw / Tie")}`
          ),
        ],
        [
          Markup.button.callback(
            `📊 Over 300 Runs${showOdds("Over 300 Runs")}`,
            `play_prematch|${shortId}|${encodeURIComponent("Over 300 Runs")}`
          ),
          Markup.button.callback(
            `📉 Under 300 Runs${showOdds("Under 300 Runs")}`,
            `play_prematch|${shortId}|${encodeURIComponent("Under 300 Runs")}`
          ),
        ],
        [Markup.button.callback("🔄 Refresh Pool", `refresh_pool_${shortId}`)],
      ];

  const header =
    `🟢 *Pre-Match Predictions* — ${match.name}\n\n` +
    `📅 *Scheduled:* ${when} IST\n` +
    `🏟️ *Venue:* ${venue}\n` +
    `🧾 *Format:* ${payload?.matchFormat || match.match_format || "Unknown"}\n\n`;

  const poolStatusMsg =
    locked
      ? "🔒 *Predictions Closed*\n\n"
      : status === "pending"
      ? "🚧 *Waiting for more players...*\n_Odds unlock once 3 different bet options exist._\n\n"
      : "✅ *Pool Active — Odds Live!*\n\n";

  const msg =
    header + poolStatusMsg + "Select a market below to lock your 100 G play.";

  await ctx.reply(msg, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

/* ------------------------------------------------------------
 📲 Entry point
------------------------------------------------------------ */
export async function startPreMatchBet(ctx, matchId) {
  try {
    await buildPreMatchScreen(ctx, matchId);
  } catch (err) {
    logger.error(`❌ [PreMatchBet] ${err.message}`);
    await ctx.reply("⚠️ Failed to load pre-match screen.");
  }
}

/* ------------------------------------------------------------
 🧩 Handler Registration
------------------------------------------------------------ */
export default function preMatchBetHandler(bot) {

  // 🔄 Refresh pool
  bot.action(/^refresh_pool_(.+)/, async (ctx) => {
    const shortId = ctx.match[1];
    const matchId = global.matchIdMap.get(shortId) || shortId;

    try {
      await ctx.answerCbQuery("🔄 Refreshing...");
      await buildPreMatchScreen(ctx, matchId);
    } catch (err) {
      logger.error(`⚠️ [RefreshPool] ${err.message}`);
    }
  });

  // 🎯 Selecting a pre-match option
  bot.action(/^play_prematch\|(.+)\|(.+)$/, async (ctx) => {
    try {
      const shortId = ctx.match[1];
      const playOption = decodeURIComponent(ctx.match[2]);

      const matchId = global.matchIdMap.get(shortId) || shortId;
      const match = await getMatchById(matchId);

      if (!match) return ctx.reply("❌ Match not found.");

      // ------------------------------------------------------------
      // ⭐ Save pending bet for betHandler.js
      // ------------------------------------------------------------
      ctx.session.currentPlay = {
        matchId,
        marketType: "PreMatch",
        playOption: playOption,
        matchName: match.name,
        stake: 100, // ← required for betHandler
      };

      await ctx.reply(
        `🎯 *${match.name}*\n📊 Market: *${playOption}*\n\n💰 Fixed Play: 100 G\nConfirm below:`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [{ text: "💰 Place Play (100 G)", callback_data: "play_confirm_100g" }],
            [{ text: "❌ Cancel Play", callback_data: "cancel_play" }],
            [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
          ]),
        }
      );
    } catch (err) {
      logger.error(`❌ [PreMatchSelect] ${err.message}`);
      await ctx.answerCbQuery("⚠️ Could not load play info.");
    }
  });

  // ❌ Cancel active bet
  bot.action("cancel_play", async (ctx) => {
    try {
      ctx.session.currentPlay = null;
      await ctx.answerCbQuery("❌ Play cancelled.");
      await ctx.reply("✅ Play cancelled. You can choose another match anytime.");
    } catch (err) {
      logger.warn(`⚠️ [CancelPlayButton] ${err.message}`);
    }
  });

  // Locked pool safeguard
  bot.action("noop_locked", async (ctx) => {
    await ctx.answerCbQuery("🔒 Predictions closed after toss.");
  });
}
