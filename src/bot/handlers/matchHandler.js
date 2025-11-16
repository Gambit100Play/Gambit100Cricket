// ============================================================
// 🏏 Match Handler (v5.0 — Redis Cached + Rate Limited)
// ============================================================
//
// • Uses Redis matchCache.js
// • Fast match list retrieval
// • Rate limits: matches, refresh, predict_<id>
// • Treats locked_pre as LIVE
// • Skips Test matches
// ============================================================

import { Markup } from "telegraf";
import { DateTime } from "luxon";

// ✔ Correct imports (from your updated matchCache.js)
import {
  getMatchesCached,
  getMatchCachedById,
  invalidateMatchCache
} from "../../redis/matchCache.js";

import { rateLimit } from "../../redis/rateLimit.js";
import { startPreMatchBet } from "./preMatchBetHandler.js";
import { logger } from "../../utils/logger.js";

/* ---------- Format UTC → Local ---------- */
function formatStartTimeFromUTC(match, zone = "Asia/Kolkata") {
  try {
    if (!match?.start_time) return "TBA";

    const iso =
      typeof match.start_time === "string"
        ? match.start_time.replace(" ", "T") +
          (match.start_time.includes("Z") ? "" : "Z")
        : match.start_time.toISOString();

    const dt = DateTime.fromISO(iso, { zone: "utc" });
    return dt.isValid ? dt.setZone(zone).toFormat("dd LLL yyyy, hh:mm a") : "Invalid";
  } catch {
    return "Invalid";
  }
}

/* ---------- Determine User Timezone ---------- */
function getUserTimeZone(ctx) {
  const lang = ctx.from?.language_code?.toLowerCase() || "en";
  const zones = {
    en: "Asia/Kolkata",
    hi: "Asia/Kolkata",
    en_us: "America/New_York",
    en_gb: "Europe/London",
    ar: "Asia/Dubai",
    ru: "Europe/Moscow",
    id: "Asia/Jakarta",
    nl: "Europe/Amsterdam",
  };
  return zones[lang] || "Asia/Kolkata";
}

/* ---------- Escape HTML ---------- */
function html(t = "") {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- Unified LIVE Condition ---------- */
function isLiveStatus(status = "") {
  return /(live|playing|in progress|locked_pre)/.test(status.toLowerCase());
}

/* ============================================================
 🎯 Main Match Handler
============================================================ */
export default function matchHandler(bot) {

  // -----------------------------------------------------------
  // 📌 OPEN MATCH LIST — "matches"
  // -----------------------------------------------------------
  bot.action("matches", async (ctx) => {
    const user = ctx.from.id;

    const allowed = await rateLimit(`matches_open:${user}`, 3, 3);
    if (!allowed)
      return ctx.answerCbQuery("⏳ Slow down…");

    try { await ctx.answerCbQuery("Loading..."); } catch {}
    await showMatches(ctx);
  });

  // -----------------------------------------------------------
  // 🔄 REFRESH MATCH LIST — "matches_refresh"
  // -----------------------------------------------------------
  bot.action("matches_refresh", async (ctx) => {
    const user = ctx.from.id;

    const allowed = await rateLimit(`matches_refresh:${user}`, 3, 4);
    if (!allowed)
      return ctx.answerCbQuery("⏳ Too fast…");

    try { await ctx.answerCbQuery("Refreshing..."); } catch {}

    await invalidateMatchCache(); // ✔ ONLY PLACE where invalidation should happen
    await showMatches(ctx);
  });

  // -----------------------------------------------------------
  // ⛔ Disabled Buttons
  // -----------------------------------------------------------
  bot.action("disabled_live", (ctx) =>
    ctx.answerCbQuery("🔒 Live predictions open after toss.")
  );
  bot.action("disabled_pre", (ctx) =>
    ctx.answerCbQuery("🔒 Pre-match predictions closed.")
  );

  // -----------------------------------------------------------
  // 🎯 PREDICT NOW — "predict_<matchId>"
  // -----------------------------------------------------------
  bot.action(/^predict_(.+)/, async (ctx) => {
    const user = ctx.from.id;

    const allowed = await rateLimit(`predict:${user}`, 5, 5);
    if (!allowed)
      return ctx.answerCbQuery("⏳ Hold on…");

    await ctx.answerCbQuery();

    const matchId = ctx.match[1];

    // ⭐ Correct Redis call
    const match = await getMatchCachedById(matchId);

    if (!match) return ctx.reply("❌ Match not found.");

    const zone = getUserTimeZone(ctx);
    const live = isLiveStatus(match.status);

    let tossText = "🕓 <b>Toss:</b> Not yet done";

    try {
      const payload =
        typeof match.api_payload === "object"
          ? match.api_payload
          : JSON.parse(match.api_payload || "{}");

      const w = payload?.tossResults?.tossWinnerName || payload?.tossWinnerName;
      const d = payload?.tossResults?.decision || payload?.tossDecision;

      if (w && d)
        tossText = `🪙 <b>Toss:</b> ${html(`${w} won the toss and chose to ${d} first`)}`;
    } catch {}

    const info = `
<b>${live ? "🔴 LIVE" : "🕓 UPCOMING"}</b> | <b>${html(match.name)}</b>
🏆 <b>${html(match.series_name || "Unknown Series")}</b>
📘 <b>Format:</b> ${html(match.match_format || "TBD")}
📅 <b>${html(formatStartTimeFromUTC(match, zone))}</b>
${tossText}
📍 <b>Status:</b> ${html(match.status || "TBD")}
`.trim();

    const buttons = live
      ? [
          [
            Markup.button.callback("⚫ Pre-Match (Locked)", "disabled_pre"),
            Markup.button.callback("🔴 Live Prediction", `live_${match.match_id}`)
          ],
          [Markup.button.callback("🔙 Back to Matches", "matches")],
        ]
      : [
          [
            Markup.button.callback("🎯 Pre-Match Prediction", `prematch_${match.match_id}`),
            Markup.button.callback("⚫ Live (Locked)", "disabled_live")
          ],
          [Markup.button.callback("🔙 Back to Matches", "matches")],
        ];

    await ctx.reply(`${info}\n\n🎯 <b>Choose your prediction type:</b>`, {
      parse_mode: "HTML",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  });

  // -----------------------------------------------------------
  // 🎯 PRE-MATCH BET
  // -----------------------------------------------------------
  bot.action(/^prematch_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();

    try {
      await startPreMatchBet(ctx, ctx.match[1]);
    } catch (err) {
      logger.error(`❌ [PreMatchBet] ${err.message}`);
      ctx.reply("⚠️ Could not open pre-match prediction screen.");
    }
  });
}

/* ============================================================
 📅 SHOW MATCHES (Uses Redis cache)
============================================================ */
async function showMatches(ctx) {

  // ⭐ Fetch from Redis (NO CALLBACK)
  const all = await getMatchesCached();

  if (!all?.length)
    return ctx.reply("📭 No live or upcoming matches right now.");

  const filtered = all
    .filter((m) => {
      const status = (m.status || "").toLowerCase();
      const format = (m.match_format || "").toLowerCase();

      const activeStatuses = [
        "live", "playing", "in progress",
        "upcoming", "scheduled", "locked_pre"
      ];

      return activeStatuses.some((x) => status.includes(x)) && !format.includes("test");
    })
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5);

  if (!filtered.length)
    return ctx.reply("🧪 Only Test matches are active. Predictions reopen soon!");

  const zone = getUserTimeZone(ctx);
  const now = DateTime.now().setZone(zone);

  await ctx.reply("<b>📅 Top 5 Matches (Live or Upcoming)</b>", {
    parse_mode: "HTML",
  });

  for (const m of filtered) {
    const live = isLiveStatus(m.status);
    const prefix = live ? "🔴 LIVE" : "🕓 UPCOMING";
    const when = formatStartTimeFromUTC(m, zone);

    let countdown = "⏳ <b>Start time:</b> Unknown";

    try {
      const dt = DateTime.fromISO(String(m.start_time).replace(" ", "T"), {
        zone: "utc",
      }).setZone(zone);

      const diff = dt.diff(now, ["hours", "minutes"]);
      if (diff.as("minutes") > 0) {
        const h = Math.floor(diff.hours);
        const mLeft = Math.floor(diff.minutes % 60);
        countdown = `⏳ <b>Starts in:</b> ${h > 0 ? `${h}h ` : ""}${mLeft}m`;
      } else {
        countdown = "🪙 <b>Toss likely completed</b>";
      }
    } catch {}

    const msg = `
<b>${prefix}</b> | <b>${html(m.name)}</b>
🏆 <b>${html(m.series_name || "Unknown Series")}</b>
📘 <b>Format:</b> ${html(m.match_format || "TBD")}
📅 <b>${html(when)}</b>
${countdown}
🏟️ ${m.venue ? html(m.venue) + (m.city ? `, ${html(m.city)}` : "") : "Venue TBA"}
📍 <b>Status:</b> ${html(m.status?.toUpperCase() || "TBD")}
`.trim();

    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("🎯 Predict Now", `predict_${m.match_id}`)],
    ]);

    await ctx.reply(msg, {
      parse_mode: "HTML",
      reply_markup: buttons.reply_markup,
    });
  }

  const footer = Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Refresh", "matches_refresh")],
    [Markup.button.callback("🔙 Back to Main Menu", "main_menu")],
  ]);

  await ctx.reply("🔄 You can refresh or go back 👇", {
    parse_mode: "HTML",
    reply_markup: footer.reply_markup,
  });

  await ctx.reply(
    `📡 <b>Last Updated:</b> ${html(now.toFormat("dd LLL yyyy, hh:mm a"))}`,
    { parse_mode: "HTML" }
  );
}
