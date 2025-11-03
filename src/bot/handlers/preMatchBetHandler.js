import { Markup } from "telegraf";
import { getMatchById, getDynamicOdds, query } from "../../db/db.js";
import { DateTime } from "luxon";
import { getPoolInfo } from "../../db/poolLogic.js";
import { logger } from "../../utils/logger.js";

global.matchIdMap = global.matchIdMap || new Map();

/* ============================================================
 🕒 Convert UTC → readable IST
============================================================ */
function formatStartIST(input) {
  if (!input) return "TBA";
  try {
    let dt;
    if (input instanceof Date) dt = DateTime.fromJSDate(input);
    else if (typeof input === "string")
      dt = input.includes("T")
        ? DateTime.fromISO(input)
        : DateTime.fromSQL(input);
    else if (typeof input === "number") dt = DateTime.fromMillis(input);

    if (!dt?.isValid) return "Invalid Time";
    return dt.setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  } catch (err) {
    logger.error(`🕒 [formatStartIST] Failed: ${err.message}`);
    return "Invalid Time";
  }
}

/* ============================================================
 🧩 Build Pre-Match Screen
============================================================ */
async function buildPreMatchScreen(ctx, matchId) {
  logger.info(`🎯 [PreMatchScreen] Building for Match ID: ${matchId}`);

  const match = await getMatchById(matchId);
  if (!match) {
    logger.warn(`❌ Match ${matchId} not found in DB`);
    return ctx.reply("❌ Match not found in database.");
  }

  // --- Parse payload safely ---
  let payload = {};
  let teamA = match.team1 || "Team A";
  let teamB = match.team2 || "Team B";

  try {
    const raw =
      typeof match.api_payload === "object"
        ? match.api_payload
        : JSON.parse(match.api_payload || "{}");

    if (raw?.team1?.teamName && raw?.team2?.teamName) {
      teamA = raw.team1.teamName;
      teamB = raw.team2.teamName;
    }
    payload = raw;
  } catch (err) {
    logger.warn(`⚠️ [PreMatch] Invalid api_payload: ${err.message}`);
  }

  /* --- Defensive fallback for null or empty payload --- */
  if (!payload || Object.keys(payload).length === 0) {
    logger.warn(`⚠️ [PreMatch] api_payload missing for ${matchId}, using DB fallback`);
    payload = {
      team1: { teamName: match.team1 || "Team A" },
      team2: { teamName: match.team2 || "Team B" },
      venueInfo: {
        ground: match.venue || "Unknown Ground",
        city: match.city || "",
        country: match.country || "Unknown",
      },
      matchFormat: match.match_format || "Unknown",
      state: match.status || "upcoming",
    };
  }

  const when = formatStartIST(match.start_time);
  logger.info(`🕒 Match scheduled at: ${when}`);

  // --- Pool info ---
  const pool = await getPoolInfo(matchId, "PreMatch");
  logger.info(`🏊 Pool Info: ${pool ? pool.status : "No pool found"}`);

  // --- Distinct plays ---
  const distinctRes = await query(
    `SELECT COUNT(DISTINCT LOWER(bet_option)) AS unique_plays
     FROM bets WHERE match_id=$1 AND LOWER(market_type)=LOWER($2)`,
    [matchId, "PreMatch"]
  );
  const distinctPlays = Number(distinctRes.rows[0]?.unique_plays || 0);
  const status = distinctPlays >= 3 ? "active" : "pending";
  const isLocked = pool?.status === "locked" || status === "locked";

  logger.info(
    `🎮 Pool Status → distinct_plays=${distinctPlays}, status=${status}, locked=${isLocked}`
  );

  const poolHeader = isLocked
    ? `🔒 *Predictions Closed*\nToss occurred — pre-match predictions are now locked.\n\n`
    : status === "pending"
    ? `🚧 *Pool not active yet — waiting for more players to join.*\n💬 It’ll activate soon once enough plays are placed.\n\n`
    : `✅ *Pool active — live odds running!*\n\n`;

  // --- Odds ---
  const oddsData = await getDynamicOdds(matchId, "PreMatch");
  logger.info(`🎲 getDynamicOdds → ${oddsData?.length || 0} rows`);
  if (oddsData?.length)
    logger.info(`🎲 Odds Table:\n${JSON.stringify(oddsData, null, 2)}`);

  const oddsMap = {};
  for (const o of oddsData || [])
    oddsMap[o.bet_option.toLowerCase().trim()] = o.odds;
  logger.info(`🧩 OddsMap keys: [${Object.keys(oddsMap).join(", ")}]`);

  const showOdds = (opt) => {
    if (status !== "active") return "";
    const key = opt.toLowerCase().trim();
    const base = key.replace(" to win", "").trim();
    const found = oddsMap[key] || oddsMap[base];
    return found ? ` (${found}x)` : "";
  };

  // --- Venue ---
  const venueData = payload?.venueInfo || {
    ground: payload?.venue || match.venue || "TBA",
    city: payload?.city || match.city || "",
    country: payload?.country || match.country || "Unknown",
  };
  logger.info(
    `🏟️ Venue parsed: ${venueData.ground}, ${venueData.city}, ${venueData.country}`
  );

  // --- Safe encoder ---
  const shortId = String(matchId).slice(0, 8);
  global.matchIdMap.set(shortId, matchId);
  const safe = (t) =>
    encodeURIComponent(
      String(t)
        .replace(/['"`\\]+/g, "") // remove quotes/backslashes
        .replace(/\s+/g, " ") // collapse spaces
        .trim()
    );

  // --- Keyboard ---
  const buttons = isLocked
    ? [[Markup.button.callback("🔒 Predictions Locked (Toss Done)", "noop_locked")]]
    : [
        [
          Markup.button.callback(
            `🏆 ${teamA}${showOdds(`${teamA} to Win`)}`,
            `play_prematch|${shortId}|${safe(`${teamA} to Win`)}`
          ),
          Markup.button.callback(
            `🏆 ${teamB}${showOdds(`${teamB} to Win`)}`,
            `play_prematch|${shortId}|${safe(`${teamB} to Win`)}`
          ),
        ],
        [
          Markup.button.callback(
            `🤝 Draw / Tie${showOdds("Draw / Tie")}`,
            `play_prematch|${shortId}|${safe("Draw / Tie")}`
          ),
        ],
        [
          Markup.button.callback(
            `📊 Over 300 Runs${showOdds("Over 300 Runs")}`,
            `play_prematch|${shortId}|${safe("Over 300 Runs")}`
          ),
          Markup.button.callback(
            `📉 Under 300 Runs${showOdds("Under 300 Runs")}`,
            `play_prematch|${shortId}|${safe("Under 300 Runs")}`
          ),
        ],
        [Markup.button.callback("🔄 Refresh Pool", `refresh_pool_${shortId}`)],
      ];

  // --- Final message ---
  await ctx.reply(
    `🟢 *Pre-Match Predictions* — ${match.name}\n\n` +
      `📅 *Scheduled:* ${when} IST\n` +
      `🏟️ *Venue:* ${venueData.ground}${
        venueData.city ? `, ${venueData.city}` : ""
      }\n` +
      `🌍 *Country:* ${venueData.country}\n` +
      `🧾 *Format:* ${
        payload?.matchFormat || match.match_format || "Unknown"
      }\n\n` +
      poolHeader +
      `Select a market below to lock your 100 G play.`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) }
  );
}

/* ============================================================
 📲 Entry point
============================================================ */
export async function startPreMatchBet(ctx, matchId) {
  logger.info(`🎯 [PreMatch Triggered] ${matchId}`);
  try {
    await buildPreMatchScreen(ctx, matchId);
  } catch (err) {
    logger.error(`❌ PreMatchBet error: ${err.message}`);
    try {
      await ctx.reply("⚠️ Failed to load pre-match screen. Please retry shortly.");
    } catch {}
  }
}

/* ============================================================
 🧩 Handler registration
============================================================ */
export default function preMatchBetHandler(bot) {
  // 🔄 Refresh pool
  bot.action(/^refresh_pool_(.+)/, async (ctx) => {
    const shortId = ctx.match[1];
    const matchId = global.matchIdMap.get(shortId) || shortId;
    logger.info(`🔄 [RefreshPool] Triggered for ${matchId}`);
    try {
      await ctx.answerCbQuery("🔄 Refreshing pool data...");
      await buildPreMatchScreen(ctx, matchId);
    } catch (err) {
      logger.error(`⚠️ [RefreshPool] Failed: ${err.message}`);
    }
  });

  // 🎯 Play selection
  bot.action(/^play_prematch\|(.+)\|(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery("🎯 Loading play details...");
      const shortId = ctx.match[1];
      const playOption = decodeURIComponent(ctx.match[2]);
      const matchId = global.matchIdMap.get(shortId) || shortId;
      logger.info(`🎯 [PlaySelected] "${playOption}" for match ${matchId}`);

      const match = await getMatchById(matchId);
      if (!match) return ctx.reply("❌ Match not found in database.");

      const pool = await getPoolInfo(matchId, "PreMatch");
      if (pool?.status === "locked") {
        return ctx.reply(
          `🔒 Predictions are closed for *${match.name}*.\nToss has occurred.`,
          { parse_mode: "Markdown" }
        );
      }

      const distinctRes = await query(
        `SELECT COUNT(DISTINCT LOWER(bet_option)) AS unique_plays
         FROM bets WHERE match_id=$1 AND LOWER(market_type)=LOWER($2)`,
        [matchId, "PreMatch"]
      );
      const distinctPlays = Number(distinctRes.rows[0]?.unique_plays || 0);
      const status = distinctPlays >= 3 ? "active" : "pending";
      const poolMsg =
        status === "pending"
          ? "🚧 Pool not active yet — it’ll activate soon once more plays are placed."
          : "✅ Pool active — Odds are live!";

      if (typeof bot.startPlay === "function") {
        return await bot.startPlay(ctx, match.name, "PreMatch", playOption, matchId);
      }

      await ctx.reply(
        `🎯 *${match.name}*\n📊 Market: *${playOption}*\n${poolMsg}\n\n💰 Fixed play: 100 G\nSelect below:`,
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
      logger.error(`❌ [PreMatchPlay] Error: ${err.message}`);
      try {
        await ctx.answerCbQuery("⚠️ Failed to load play info");
      } catch {}
    }
  });

  // 🔒 No-op safeguard
  bot.action("noop_locked", async (ctx) => {
    try {
      await ctx.answerCbQuery("🔒 Predictions closed after toss");
    } catch {}
  });
}
