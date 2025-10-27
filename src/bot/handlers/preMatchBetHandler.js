import { Markup } from "telegraf";
import { getMatchById, getDynamicOdds } from "../../db/db.js";
import { DateTime } from "luxon";
import { getPoolInfo, getPoolStatus } from "../../db/poolLogic.js";

global.matchIdMap = global.matchIdMap || new Map();

/* ============================================================
 🕒 Convert match start time to readable IST format
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
 🧩 Core pre-match betting screen builder
============================================================ */
async function buildPreMatchScreen(ctx, matchId) {
  const match = await getMatchById(matchId);
  if (!match) return ctx.reply("❌ Match not found in database.");

  // ---- Team names parsing ----
  let teamA = "Team A";
  let teamB = "Team B";
  let payload = {};
  try {
    payload =
      typeof match.api_payload === "object"
        ? match.api_payload
        : JSON.parse(match.api_payload || "{}");

    if (Array.isArray(payload.teams) && payload.teams.length === 2)
      [teamA, teamB] = payload.teams;
  } catch (err) {
    console.warn("⚠️ Error parsing api_payload:", err.message);
  }

  const when = formatStartIST(match.start_time);

  // ---- Unified Pool Info ----
  const minNeeded = 10;
  const pool = await getPoolInfo(matchId, "PreMatch");
  const participants = pool?.participants || 0;
  const status = getPoolStatus(participants, minNeeded);
  const remaining = Math.max(minNeeded - participants, 0);
  const progressBar = pool?.progressBar || "░░░░░░░░░░";

  const poolHeader =
    `👥 *Players Joined:* ${participants}/${minNeeded}\n` +
    `Progress: ${progressBar} (${pool?.progress || 0}%)\n` +
    (status === "pending"
      ? `🚧 Pool not active yet — ${remaining} more needed to activate.\n\n`
      : "✅ Pool active — odds are live!\n\n");

  // ---- Odds ----
  const oddsData = await getDynamicOdds(matchId, "PreMatch");
  const oddsMap = {};
  for (const o of oddsData) oddsMap[o.bet_option] = o.odds;

  const showOdds = (opt) => (oddsMap[opt] ? `${oddsMap[opt]}x` : "1.00x");

  const shortId = String(matchId).slice(0, 8);
  global.matchIdMap.set(shortId, matchId);
  const safe = (t) => encodeURIComponent(t);

  // ---- Options ----
  const options = [
    `${teamA} to Win`,
    `${teamB} to Win`,
    "Draw / Tie",
    "Over 300 Runs",
    "Under 300 Runs",
  ];

  // ---- Inline Keyboard ----
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `🏆 ${teamA} (${showOdds(`${teamA} to Win`)})`,
        `bet_prematch|${shortId}|${safe(`${teamA} to Win`)}`
      ),
      Markup.button.callback(
        `🏆 ${teamB} (${showOdds(`${teamB} to Win`)})`,
        `bet_prematch|${shortId}|${safe(`${teamB} to Win`)}`
      ),
    ],
    [
      Markup.button.callback(
        `🤝 Draw / Tie (${showOdds("Draw / Tie")})`,
        `bet_prematch|${shortId}|${safe("Draw / Tie")}`
      ),
    ],
    [
      Markup.button.callback(
        `📊 Over 300 Runs (${showOdds("Over 300 Runs")})`,
        `bet_prematch|${shortId}|${safe("Over 300 Runs")}`
      ),
      Markup.button.callback(
        `📉 Under 300 Runs (${showOdds("Under 300 Runs")})`,
        `bet_prematch|${shortId}|${safe("Under 300 Runs")}`
      ),
    ],
    [Markup.button.callback("🔄 Refresh Pool", `refresh_pool_${shortId}`)],
  ]);

  // ---- Final Message ----
  await ctx.reply(
    `🟢 *Pre-Match Predictions* — ${match.name}\n\n` +
      `📅 *Scheduled:* ${when} IST\n` +
      `🏟️ *Venue:* ${payload.venue || "TBA"}\n` +
      `🧾 *Format:* ${payload.matchType || "Unknown"}\n\n` +
      poolHeader +
      `Each market below is part of this single shared pool.\n` +
      `Once the pool reaches ${minNeeded} players, odds will go live.\n\n` +
      `🎯 *Select your market below:*`,
    { parse_mode: "Markdown", ...keyboard }
  );
}

/* ============================================================
 📲 External entry point
============================================================ */
export async function startPreMatchBet(ctx, matchId) {
  console.log("🎯 Delegated Pre-Match start for ID:", matchId);
  await buildPreMatchScreen(ctx, matchId);
}

/* ============================================================
 🧩 Register handlers for odds refresh + bet selection
============================================================ */
export default function preMatchBetHandler(bot) {
  /* ---------------- Refresh Pool ---------------- */
  bot.action(/^refresh_pool_(.+)/, async (ctx) => {
    const shortId = ctx.match[1];
    const matchId = global.matchIdMap.get(shortId) || shortId;

    try {
      await ctx.answerCbQuery("🔄 Refreshing pool data...");
    } catch {}

    const pool = await getPoolInfo(matchId, "PreMatch");
    const minNeeded = 10;
    const participants = pool?.participants || 0;
    const remaining = Math.max(minNeeded - participants, 0);
    const status = getPoolStatus(participants, minNeeded);

    const msg =
      `📊 *Pool Summary*\n\n` +
      `👥 Players Joined: ${participants}/${minNeeded}\n` +
      (status === "pending"
        ? `🚧 Pool not active yet — ${remaining} more players needed.`
        : "✅ Pool active — odds are live!");

    try {
      await ctx.editMessageText(msg, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(msg, { parse_mode: "Markdown" });
    }
  });

  /* ---------------- Bet Selection ---------------- */
  bot.action(/^bet_prematch\|(.+)\|(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery("🪙 Loading bet details...");
      const shortId = ctx.match[1];
      const betOption = decodeURIComponent(ctx.match[2]);
      const matchId = global.matchIdMap.get(shortId) || shortId;
      const match = await getMatchById(matchId);
      if (!match) return;

      // Only fetch unified pool info
      const pool = await getPoolInfo(matchId, "PreMatch");
      const minNeeded = 10;
      const participants = pool?.participants || 0;
      const status = getPoolStatus(participants, minNeeded);
      const remaining = Math.max(minNeeded - participants, 0);

      const poolMsg =
        status === "pending"
          ? `🚧 Pool not active yet — ${remaining} more players needed to activate.`
          : "✅ Pool active — Odds are live!";

      // 🔹 Prevent duplicate messages: only one output path
      if (typeof bot.startBet === "function") {
        return await bot.startBet(ctx, match.name, "PreMatch", betOption, matchId);
      }

      // fallback message if no startBet defined
      await ctx.reply(
        `🎯 *${match.name}*\n` +
          `📊 Market: *${betOption}*\n` +
          `${poolMsg}\n\n` +
          `💰 Please enter your stake amount next.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("❌ Error handling pre-match bet:", err);
      try {
        await ctx.answerCbQuery("⚠️ Failed to load bet info");
      } catch {}
    }
  });
}
