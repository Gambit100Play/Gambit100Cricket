// ============================================================
// 🏏 Match Handler (v4.0 — HTML Mode, Clean Output & Predict Buttons)
// ============================================================
import { Markup } from "telegraf";
import { DateTime } from "luxon";
import { getMatches, getMatchById } from "../../db/db.js";
import { startPreMatchBet } from "./preMatchBetHandler.js";
import { logger } from "../../utils/logger.js";

/* ---------- Format UTC → Local ---------- */
function formatStartTimeFromUTC(match, zone = "Asia/Kolkata") {
  try {
    if (!match?.start_time) return "TBA";
    const iso = typeof match.start_time === "string"
      ? match.start_time.replace(" ", "T") + (match.start_time.includes("Z") ? "" : "Z")
      : match.start_time.toISOString();
    const dt = DateTime.fromISO(iso, { zone: "utc" });
    return dt.isValid ? dt.setZone(zone).toFormat("dd LLL yyyy, hh:mm a") : "Invalid";
  } catch {
    return "Invalid";
  }
}

/* ---------- User Timezone ---------- */
function getUserTimeZone(ctx) {
  const lang = ctx.from?.language_code?.toLowerCase() || "en";
  const zones = {
    en: "Asia/Kolkata", hi: "Asia/Kolkata",
    en_us: "America/New_York", en_gb: "Europe/London",
    ar: "Asia/Dubai", ru: "Europe/Moscow",
    id: "Asia/Jakarta", nl: "Europe/Amsterdam",
  };
  return zones[lang] || "Asia/Kolkata";
}

/* ---------- Escape HTML ---------- */
function html(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------- Main Handler ---------- */
export default function matchHandler(bot) {
  bot.action("matches", async (ctx) => {
    try { await ctx.answerCbQuery("Loading matches..."); } catch {}
    await showMatches(ctx);
  });

  bot.action("matches_refresh", async (ctx) => {
    try { await ctx.answerCbQuery("Refreshing..."); } catch {}
    await showMatches(ctx);
  });

  bot.action("disabled_live", (ctx) =>
    ctx.answerCbQuery("🔒 Live predictions open after toss.")
  );
  bot.action("disabled_pre", (ctx) =>
    ctx.answerCbQuery("🔒 Pre-match predictions closed.")
  );

  /* ---------- Predict Now ---------- */
  bot.action(/^predict_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found.");

    const zone = getUserTimeZone(ctx);
    const live = /(live|playing|in progress|locked_pre)/.test(
      (match.status || "").toLowerCase()
    );

    let tossText = "🕓 <b>Toss:</b> Not yet done";
    try {
      const p =
        typeof match.api_payload === "object"
          ? match.api_payload
          : JSON.parse(match.api_payload || "{}");
      const w = p?.tossResults?.tossWinnerName || p?.tossWinnerName;
      const d = p?.tossResults?.decision || p?.tossDecision;
      if (w && d) tossText = `🪙 <b>Toss:</b> ${html(`${w} won the toss and chose to ${d} first`)}`;
    } catch {}

    const info = `
<b>${live ? "🔴 LIVE" : "🕓 UPCOMING"}</b> | <b>${html(match.name)}</b>
📅 <b>${html(formatStartTimeFromUTC(match, zone))}</b>
${tossText}
📍 <b>Status:</b> ${html(match.status || "TBD")}
`.trim();

    const buttons = live
      ? [
          [Markup.button.callback("⚫ Pre-Match (Locked)", "disabled_pre"),
           Markup.button.callback("🔴 Live Prediction", `live_${match.match_id}`)],
          [Markup.button.callback("🔙 Back to Matches", "matches")],
        ]
      : [
          [Markup.button.callback("🎯 Pre-Match Prediction", `prematch_${match.match_id}`),
           Markup.button.callback("⚫ Live (Locked)", "disabled_live")],
          [Markup.button.callback("🔙 Back to Matches", "matches")],
        ];

    await ctx.reply(`${info}\n\n🎯 <b>Choose your prediction type:</b>`, {
      parse_mode: "HTML",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  });

  /* ---------- Pre-Match ---------- */
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

/* ---------- Show Matches ---------- */
async function showMatches(ctx) {
  const all = await getMatches();
  if (!all?.length)
    return ctx.reply("📭 No live or upcoming matches right now.");

  const filtered = all
    .filter((m) =>
      ["live", "playing", "in progress", "upcoming", "scheduled", "locked_pre"].some((x) =>
        (m.status || "").toLowerCase().includes(x)
      )
    )
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5);

  const zone = getUserTimeZone(ctx);
  const now = DateTime.now().setZone(zone);

  await ctx.reply("<b>📅 Top 5 Matches (Live or Upcoming)</b>", {
    parse_mode: "HTML",
  });

  for (const m of filtered) {
    const live = /(live|playing|in progress|locked_pre)/.test(
      (m.status || "").toLowerCase()
    );
    const prefix = live ? "🔴 LIVE" : "🕓 UPCOMING";
    const when = formatStartTimeFromUTC(m, zone);

    // Countdown
    let countdown = "⏳ <b>Start time:</b> Unknown";
    try {
      const dt = DateTime.fromISO(String(m.start_time).replace(" ", "T"), { zone: "utc" }).setZone(zone);
      const diff = dt.diff(now, ["hours", "minutes"]);
      if (diff.as("minutes") > 0) {
        const h = Math.floor(diff.hours);
        const mLeft = Math.floor(diff.minutes % 60);
        countdown = `⏳ <b>Starts in:</b> ${h > 0 ? `${h}h ` : ""}${mLeft}m`;
      } else countdown = "🪙 <b>Toss likely completed</b>";
    } catch {}

    const msg = `
<b>${prefix}</b> | <b>${html(m.name)}</b>
🏆 <b>${html(m.series_name || "Unknown Series")} (${html(m.match_format || "TBD")})</b>
📅 <b>${html(when)}</b>
${countdown}
🏟️ ${m.venue ? html(m.venue) + (m.city ? `, ${html(m.city)}` : "") : "Venue TBA"}
🌍 <b>Country:</b> ${html(m.country || "Unknown")}
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

  await ctx.reply(`📡 <b>Last Updated:</b> ${html(now.toFormat("dd LLL yyyy, hh:mm a"))}`, {
    parse_mode: "HTML",
  });
}
