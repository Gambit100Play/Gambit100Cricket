import { Markup } from "telegraf";
import { DateTime } from "luxon";
import { getMatches, getMatchById } from "../../db/db.js";
import { startPreMatchBet } from "./preMatchBetHandler.js";
import { logger as customLogger } from "../../utils/logger.js";

const logger = customLogger || console;

/* ============================================================
 🕒 Safe universal formatter for start_time
============================================================ */
function formatStartTimeFromUTC(match, userZone = "Asia/Kolkata") {
  try {
    let input = match.start_time;

    // 🧩 Case 1: Already a Date
    if (input instanceof Date) {
      const dt = DateTime.fromJSDate(input, { zone: "utc" }).setZone(userZone);
      return dt.isValid ? dt.toFormat("dd LLL yyyy, hh:mm a ZZZZ") : "Invalid DateTime";
    }

    // 🧩 Case 2: "Sat Nov 01 2025 00:00:00 GMT+0530 (India Standard Time)" OR similar
    if (typeof input === "string" && /GMT|\b[A-Z]{3,}\b/.test(input)) {
      const dt = DateTime.fromJSDate(new Date(input), { zone: "utc" }).setZone(userZone);
      return dt.isValid ? dt.toFormat("dd LLL yyyy, hh:mm a ZZZZ") : "Invalid DateTime";
    }

    // 🧩 Case 3: ISO / SQL strings
    if (typeof input === "string") {
      let normalized = input.trim().replace(" ", "T");
      if (!/[Z+-]\d{2}/.test(normalized)) normalized += "Z";
      const dt = DateTime.fromISO(normalized, { zone: "utc" }).setZone(userZone);
      return dt.isValid ? dt.toFormat("dd LLL yyyy, hh:mm a ZZZZ") : "Invalid DateTime";
    }

    // 🧩 Case 4: Fallback with start_date + local time
    if (!input && match.start_date && match.start_time_local) {
      const dateStr = `${match.start_date} ${match.start_time_local}`;
      const dt = DateTime.fromFormat(dateStr, "yyyy-LL-dd HH:mm:ss", { zone: "utc" }).setZone(userZone);
      return dt.isValid ? dt.toFormat("dd LLL yyyy, hh:mm a ZZZZ") : "TBA";
    }

    return "TBA";
  } catch (err) {
    logger.error(`❌ [formatStartTimeFromUTC] ${err.message}`);
    return "Invalid DateTime";
  }
}


/* ============================================================
 🌍 Determine user's timezone by locale
============================================================ */
function getUserTimeZone(ctx) {
  const locale = ctx.from?.language_code?.toLowerCase() || "en";
  const regionMap = {
    en: "Asia/Kolkata",
    en_us: "America/New_York",
    en_gb: "Europe/London",
    hi: "Asia/Kolkata",
    ar: "Asia/Dubai",
    ru: "Europe/Moscow",
    id: "Asia/Jakarta",
    nl: "Europe/Amsterdam",
  };
  return regionMap[locale] || "Asia/Kolkata";
}

/* ============================================================
 📱 Main Match Handler
============================================================ */
export default function matchHandler(bot) {
  bot.action("matches", async (ctx) => {
    try { await ctx.answerCbQuery("Loading matches..."); } catch {}
    await showMatches(ctx);
  });

  bot.action("matches_refresh", async (ctx) => {
    try { await ctx.answerCbQuery("Refreshing..."); } catch {}
    await showMatches(ctx);
  });

  bot.action("disabled_live", async (ctx) => {
    try { await ctx.answerCbQuery("🔒 Live predictions will open once toss is done!"); } catch {}
  });

  bot.action("disabled_pre", async (ctx) => {
    try { await ctx.answerCbQuery("🔒 Pre-match predictions closed — match is live!"); } catch {}
  });

  // 🎯 Predict Now
  bot.action(/^predict_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found or has expired.");

    const userZone = getUserTimeZone(ctx);
    const status = (match.status || "").toLowerCase();
    const isLive = /(live|in progress|playing)/.test(status);

    // Parse toss info
    let payload = {};
    try {
      payload = typeof match.api_payload === "object"
        ? match.api_payload
        : JSON.parse(match.api_payload || "{}");
    } catch (err) {
      logger.warn(`⚠️ Could not parse payload: ${err.message}`);
    }

    const tossWinner =
      payload?.tossResults?.tossWinnerName ||
      payload?.tossWinnerName ||
      payload?.tossWinner ||
      payload?.toss_winner ||
      null;

    const tossDecision =
      payload?.tossResults?.decision ||
      payload?.tossDecision ||
      payload?.toss_decision ||
      null;

    const tossString =
      tossWinner && tossDecision
        ? `${tossWinner} won the toss and chose to ${tossDecision.toLowerCase()} first`
        : null;

    const tossDone = Boolean(tossString);
    const tossStatus = tossDone
      ? `🪙 *Toss:* ${tossString}`
      : "🕓 *Toss:* Not yet done";

    const isEligibleForLive = isLive || tossDone;
    const when = formatStartTimeFromUTC(match, userZone);

    const matchInfo = isEligibleForLive
      ? `🏏 *${match.name}*\n📅 *Live:* ${when}\n📍 *Status:* 🔴 LIVE\n${tossStatus}`
      : `🏏 *${match.name}*\n📅 *Scheduled:* ${when}\n📍 *Status:* 🕓 Awaiting Toss\n${tossStatus}`;

    const buttons = [];
    if (isEligibleForLive) {
      buttons.push([
        Markup.button.callback("⚫ Pre-Match (Locked)", "disabled_pre"),
        Markup.button.callback("🔴 Live Match Prediction", `live_${match.id}`),
      ]);
    } else {
      buttons.push([
        Markup.button.callback("🎯 Pre-Match Prediction", `prematch_${match.id}`),
        Markup.button.callback("⚫ Live Match (Locked)", "disabled_live"),
      ]);
    }
    buttons.push([Markup.button.callback("🔙 Back to Matches", "matches")]);

    await ctx.reply(`${matchInfo}\n\n🎯 *Choose your prediction type:*`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // 🎯 Pre-Match Prediction
  bot.action(/^prematch_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    logger.info(`🎯 [PreMatch Triggered] ${matchId}`);
    try {
      await startPreMatchBet(ctx, matchId);
    } catch (err) {
      logger.error(`❌ PreMatchBet error: ${err.message}`);
      ctx.reply("⚠️ Could not open pre-match prediction screen.");
    }
  });

  // 🔴 Live placeholder
  bot.action(/^live_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    logger.info(`🔴 [LiveMatch Triggered] ${matchId}`);
    ctx.reply("🚧 Live predictions coming soon.", { parse_mode: "Markdown" });
  });
}

/* ============================================================
 🧭 Helper: Show Top 5 Matches
============================================================ */
async function showMatches(ctx) {
  const matches = await getMatches();
  if (!matches?.length)
    return ctx.reply("📭 No live or scheduled matches available right now.");

  const filtered = matches
    .filter((m) =>
      ["live", "in progress", "playing", "upcoming", "scheduled", "fixture"].some((x) =>
        (m.status || "").toLowerCase().includes(x)
      )
    )
    .sort((a, b) => new Date(a.start_time || a.start_date) - new Date(b.start_time || b.start_date))
    .slice(0, 5);

  if (!filtered.length)
    return ctx.reply("📭 No live or scheduled matches available right now.");

  const userZone = getUserTimeZone(ctx);
  const nowLocal = DateTime.now().setZone(userZone);

  await ctx.reply("📅 *Top 5 Matches (Live or Upcoming)*", { parse_mode: "Markdown" });

  for (const m of filtered) {
    const isLive = /(live|in progress|playing)/.test((m.status || "").toLowerCase());
    const prefix = isLive ? "🔴 LIVE" : "🕓 UPCOMING";
    const when = formatStartTimeFromUTC(m, userZone);

    // countdown
    let countdown = "";
    try {
      let raw = m.start_time;
      if (raw instanceof Date) raw = raw.toISOString();
      else if (typeof raw === "string") {
        raw = raw.trim();
        if (raw.includes(" ")) raw = raw.replace(" ", "T");
        if (!/[Z+-]\d{2}/.test(raw)) raw += "Z";
      }

      if (raw) {
        const matchDT = DateTime.fromISO(raw, { zone: "utc" }).setZone(userZone);
        const diff = matchDT.diff(nowLocal, ["hours", "minutes"]);
        if (diff.as("minutes") > 0) {
          const h = Math.floor(diff.hours);
          const mLeft = Math.floor(diff.minutes % 60);
          countdown = `⏳ *Starts in:* ${h > 0 ? `${h}h ` : ""}${mLeft}m`;
        } else countdown = "🪙 *Toss likely completed*";
      } else countdown = "⏳ *Start time:* Unknown";
    } catch (err) {
      logger.warn(`⚠️ [Countdown Failed] ${err.message}`);
      countdown = "⏳ *Start time:* Unknown";
    }

    const venue = m.venue
      ? `🏟️ ${m.venue}${m.city ? `, ${m.city}` : ""}`
      : "🏟️ Venue TBA";
    const seriesInfo = `${m.series_name || "Unknown Series"} (${m.match_format || "TBD"})`;

    const messageText = `
${prefix} | *${m.name}*
🏆 *${seriesInfo}*
📅 *${when}*
${countdown}
${venue}
🌍 *Country:* ${m.country || "Unknown"}
📍 *Status:* ${m.status?.toUpperCase() || "TBD"}
    `.trim();

    const button = Markup.inlineKeyboard([
      [Markup.button.callback("🎯 Predict Now", `predict_${m.id}`)],
    ]);

    await ctx.reply(messageText, { parse_mode: "Markdown", ...button });
  }

  await ctx.reply("🔄 You can refresh or go back 👇", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🔄 Refresh", "matches_refresh")],
      [Markup.button.callback("🔙 Back to Main Menu", "main_menu")],
    ]),
  });

  const updatedAt = nowLocal.toFormat("dd LLL yyyy, hh:mm a ZZZZ");
  await ctx.reply(`📡 *Last Updated:* ${updatedAt}`, { parse_mode: "Markdown" });
}
