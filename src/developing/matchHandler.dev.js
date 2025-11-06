// ============================================================
// 🏏 Match Handler (v3.1 Stable) — DB-integrated & production-safe
// ============================================================

import { Markup } from "telegraf";
import { DateTime } from "luxon";
import { getMatches, getMatchById } from "../db/db.js"; // ✅ Corrected path for src/developing
import { startPreMatchBet } from "./preMatchBetHandler.js";
import { logger as customLogger } from "../utils/logger.js";

const logger = customLogger || console;

/* ============================================================
 🧹 Safe Markdown escape (Telegram MarkdownV2)
============================================================ */
function safeMd(text = "") {
  try {
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
  } catch {
    return text;
  }
}

/* ============================================================
 🕒 Universal start_time formatter
============================================================ */
function formatStartTimeFromUTC(match, userZone = "Asia/Kolkata") {
  try {
    const input = match.start_time;
    if (!input) return "TBA";

    let dt;
    if (input instanceof Date)
      dt = DateTime.fromJSDate(input, { zone: "utc" });
    else if (typeof input === "string") {
      const iso =
        input.includes(" ") && !input.includes("T")
          ? input.replace(" ", "T")
          : input;
      dt = DateTime.fromISO(iso, { zone: "utc" });
    }

    return dt?.isValid
      ? dt.setZone(userZone).toFormat("dd LLL yyyy, hh:mm a ZZZZ")
      : "Invalid DateTime";
  } catch (err) {
    logger.error(`❌ [formatStartTimeFromUTC] ${err.message}`);
    return "Invalid DateTime";
  }
}

/* ============================================================
 🌍 Detect timezone from Telegram locale
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
  // 📋 List Matches
  bot.action("matches", async (ctx) => {
    try {
      await ctx.answerCbQuery("Loading matches...");
    } catch {}
    await showMatches(ctx);
  });

  // 🔄 Refresh
  bot.action("matches_refresh", async (ctx) => {
    try {
      await ctx.answerCbQuery("Refreshing...");
    } catch {}
    await showMatches(ctx);
  });

  // 🔒 Disabled buttons
  bot.action("disabled_live", async (ctx) => {
    try {
      await ctx.answerCbQuery("🔒 Live predictions open after toss!");
    } catch {}
  });
  bot.action("disabled_pre", async (ctx) => {
    try {
      await ctx.answerCbQuery("🔒 Pre-match predictions closed — match is live!");
    } catch {}
  });

  // 🎯 Predict (open match info)
  bot.action(/^predict_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found or expired.");

    const userZone = getUserTimeZone(ctx);
    const status = (match.status || "").toLowerCase();
    const isLive = /(live|in progress|playing)/.test(status);

    // 🔍 Parse payload safely
    let payload = {};
    try {
      payload =
        typeof match.api_payload === "object"
          ? match.api_payload
          : JSON.parse(match.api_payload || "{}");
    } catch (err) {
      logger.warn(`⚠️ Payload parse failed: ${err.message}`);
    }

    // 🪙 Toss Info
    const tossWinner =
      payload?.tossResults?.tossWinnerName ||
      payload?.tossWinnerName ||
      null;
    const tossDecision =
      payload?.tossResults?.decision || payload?.tossDecision || null;
    const tossString =
      tossWinner && tossDecision
        ? `${tossWinner} won the toss and chose to ${tossDecision.toLowerCase()} first`
        : "Toss not yet done";

    const when = formatStartTimeFromUTC(match, userZone);
    const isEligibleForLive = isLive || Boolean(tossWinner);
    const header = isLive ? "🔴 LIVE" : "🕓 UPCOMING";

    const info = `
${header} | *${safeMd(match.name)}*
🏆 *${safeMd(match.series_name)}* (${safeMd(match.match_format)})
📅 *${safeMd(when)}*
🪙 *Toss:* ${safeMd(tossString)}
🏟️ ${safeMd(match.venue)}${match.city ? `, ${safeMd(match.city)}` : ""}
🌍 ${safeMd(match.country)}
📍 *Status:* ${safeMd(match.status?.toUpperCase() || "TBD")}
`.trim();

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

    await ctx.reply(info, {
      parse_mode: "MarkdownV2",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // 🎯 Pre-Match
  bot.action(/^prematch_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    logger.info(`🎯 [PreMatch] Opening predictions for match ${matchId}`);
    try {
      await startPreMatchBet(ctx, matchId);
    } catch (err) {
      logger.error(`❌ PreMatch error: ${err.message}`);
      ctx.reply("⚠️ Could not open pre-match prediction screen.");
    }
  });

  // 🔴 Live placeholder
  bot.action(/^live_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    logger.info(`🔴 [LiveMatch] Placeholder triggered for ${matchId}`);
    ctx.reply("🚧 Live predictions coming soon.", { parse_mode: "MarkdownV2" });
  });
}

/* ============================================================
 🧭 Helper: Display Matches (Top 5)
============================================================ */
export async function showMatches(ctx) {
  let matches = [];
  try {
    matches = await getMatches();
  } catch (err) {
    logger.warn(`⚠️ getMatches failed: ${err.message}`);
  }

  if (!matches?.length)
    return ctx.reply("📭 No live or scheduled matches right now.");

  const validMatches = matches
    .filter((m) =>
      /(live|upcoming|scheduled|playing|fixture)/.test(
        (m.status || "").toLowerCase()
      )
    )
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5);

  const userZone = getUserTimeZone(ctx);
  const nowLocal = DateTime.now().setZone(userZone);

  await ctx.reply("📅 *Top 5 Matches (Live or Upcoming)*", {
    parse_mode: "MarkdownV2",
  });

  for (const m of validMatches) {
    const prefix = /(live|playing)/.test((m.status || "").toLowerCase())
      ? "🔴 LIVE"
      : "🕓 UPCOMING";
    const when = formatStartTimeFromUTC(m, userZone);

    let countdown = "⏳ Start time unknown";
    try {
      const dt = DateTime.fromISO(
        m.start_time?.replace(" ", "T") || "",
        { zone: "utc" }
      ).setZone(userZone);
      const diff = dt.diff(nowLocal, ["hours", "minutes"]);
      countdown =
        diff.as("minutes") > 0
          ? `⏳ Starts in ${Math.floor(diff.hours)}h ${Math.floor(
              diff.minutes % 60
            )}m`
          : "🪙 Toss likely completed";
    } catch {}

    const msg = `
${prefix} | *${safeMd(m.name)}*
🏆 ${safeMd(m.series_name)} (${safeMd(m.match_format)})
📅 ${safeMd(when)}
${safeMd(countdown)}
🏟️ ${safeMd(m.venue)}${m.city ? `, ${safeMd(m.city)}` : ""}
🌍 ${safeMd(m.country)}
📍 ${safeMd(m.status?.toUpperCase() || "TBD")}
`.trim();

    const button = Markup.inlineKeyboard([
      [Markup.button.callback("🎯 Predict Now", `predict_${m.id}`)],
    ]);

    await ctx.reply(msg, { parse_mode: "MarkdownV2", ...button });
  }

  const updatedAt = nowLocal.toFormat("dd LLL yyyy, hh:mm a ZZZZ");
  await ctx.reply(`📡 *Last Updated:* ${safeMd(updatedAt)}`, {
    parse_mode: "MarkdownV2",
  });
}
