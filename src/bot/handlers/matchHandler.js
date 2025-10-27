// src/bot/handlers/matchHandler.js
import { Markup } from "telegraf";
import { DateTime } from "luxon";
import { getMatches, getMatchById } from "../../db/db.js";
import { startPreMatchBet } from "./preMatchBetHandler.js";

/* ============================================================
 🕒 Universal Safe Parser for start_time
  Handles: 
   - "2025-10-25 03:00:00+05:30"
   - "2025-10-25T03:00:00+05:30"
   - date_only + time_only combo
   - JS Date object
============================================================ */
function formatStartTimeFromUTC(match) {
  try {
    let input = match.start_time;

    // fallback if missing start_time
    if (!input && match.date_only && match.time_only) {
      input = `${match.date_only} ${match.time_only}`;
    }

    // NEW: support your DB schema (IST pair)
    if (!input && match.start_date && match.start_time_local) {
      const istStr = `${String(match.start_date).trim()} ${String(match.start_time_local).trim()}`;
      // Try ISO-friendly form first
      let dt = DateTime.fromISO(istStr.replace(" ", "T"), { setZone: true });
      if (!dt.isValid) {
        dt = DateTime.fromFormat(istStr, "yyyy-LL-dd HH:mm:ss", { zone: "Asia/Kolkata" });
      }
      if (dt?.isValid) {
        return dt.setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
      }
    }

    if (!input) return "TBA";

    let dt;
    if (input instanceof Date) {
      dt = DateTime.fromJSDate(input);
    } else if (typeof input === "string") {
      let normalized = input.trim().replace(" ", "T");
      dt = DateTime.fromISO(normalized, { setZone: true });

      if (!dt.isValid) {
        dt = DateTime.fromFormat(input.trim(), "yyyy-MM-dd HH:mm:ssZZ", { setZone: true });
      }
      if (!dt.isValid) {
        dt = DateTime.fromFormat(input.trim(), "yyyy-MM-dd HH:mm:ss", { zone: "Asia/Kolkata" });
      }
    }

    if (!dt?.isValid) {
      console.warn("⚠️ [Luxon Parse Failed for]", input);
      return "TBA";
    }

    return dt.setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  } catch (err) {
    console.error("❌ [formatStartTimeFromUTC] Error:", err.message);
    return "TBA";
  }
}


/* ============================================================
 🌍 Get user timezone based on Telegram locale
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
  };
  return regionMap[locale] || "Asia/Kolkata";
}

/* ============================================================
 📱 Match Handler
============================================================ */
export default function matchHandler(bot) {
  bot.action("matches", async (ctx) => {
    try {
      await ctx.answerCbQuery("Loading matches...");
    } catch {}
    await showMatches(ctx);
  });

  bot.action("matches_refresh", async (ctx) => {
    try {
      await ctx.answerCbQuery("Refreshing...");
    } catch {}
    await showMatches(ctx);
  });

  bot.action("disabled_live", async (ctx) => {
    try {
      await ctx.answerCbQuery("🔒 Live predictions will open once the toss is done!");
    } catch {}
  });

  bot.action("disabled_pre", async (ctx) => {
    try {
      await ctx.answerCbQuery("🔒 Pre-match predictions closed — match is live!");
    } catch {}
  });

  // 🎯 Predict Now
  bot.action(/^predict_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found or has expired.");

    const status = (match.status || "").toLowerCase();
    const isLive = /(live|in progress|playing)/.test(status);

    let payload = {};
    try {
      payload =
        typeof match.api_payload === "object"
          ? match.api_payload
          : JSON.parse(match.api_payload || "{}");
    } catch (err) {
      console.warn("⚠️ Could not parse match.api_payload:", err.message);
    }

    const tossWinner =
      payload?.tossResults?.tossWinnerName ||
      payload?.tossResults?.tossWinner ||
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

    const when = formatStartTimeFromUTC(match);

    const matchInfo = isEligibleForLive
      ? `🏏 *${match.name}*\n📅 *Live (Toss Done):* ${when}\n📍 *Status:* 🔴 LIVE\n${tossStatus}`
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
    console.log(`🎯 [PreMatch] Triggered for match ID ${matchId}`);

    try {
      await startPreMatchBet(ctx, matchId);
    } catch (err) {
      console.error("❌ Error delegating to preMatchBetHandler:", err);
      ctx.reply("⚠️ Could not open pre-match prediction screen.");
    }
  });

  bot.action(/^live_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found or has expired.");

    console.log(`🔴 [LiveMatch] Triggered for match ID ${matchId}`);
    ctx.reply(
      "🚧 Live prediction markets will open once live data is integrated.",
      { parse_mode: "Markdown" }
    );
  });
}

/* ============================================================
 🧭 Helper: Show Top 5 Matches (Live or Upcoming)
============================================================ */
/* ============================================================
 🧭 Helper: Show Top 5 Matches (Live or Upcoming)
    ➕ Added:
      - Pool closing countdown (until toss/start)
      - Auto respects toss (locks pre-match when toss done)
============================================================ */
async function showMatches(ctx) {
  const matches = await getMatches();
  if (!matches || matches.length === 0)
    return ctx.reply("📭 No live or scheduled matches available right now.");

  const filtered = matches
    .filter((m) => {
      const s = (m.status || "").toLowerCase();
      return ["live", "in progress", "playing", "upcoming", "scheduled", "fixture"].some((x) =>
        s.includes(x)
      );
    })
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5);

  if (filtered.length === 0)
    return ctx.reply("📭 No live or scheduled matches available right now.");

  await ctx.reply("📅 *Top 5 Matches (Live or Upcoming)*", { parse_mode: "Markdown" });

  for (const m of filtered) {
    const isLive = /(live|in progress|playing)/.test(m.status.toLowerCase());
    const prefix = isLive ? "🔴" : "🕓";
    const when = formatStartTimeFromUTC(m);

    // 🧮 Countdown until start (approx for toss timing)
    let closeInfo = "";
    try {
      let raw = null;
      if (m.start_date && m.start_time_local) raw = `${m.start_date} ${m.start_time_local}`;
      else if (m.start_time) raw = String(m.start_time).replace(" ", "T");

      if (raw) {
        const matchDT = DateTime.fromISO(raw, { zone: "Asia/Kolkata" });
        const now = DateTime.now().setZone("Asia/Kolkata");
        const diff = matchDT.diff(now, ["hours", "minutes"]);

        if (diff.as("minutes") > 0) {
          const h = Math.floor(diff.hours);
          const mLeft = Math.floor(diff.minutes % 60);
          const parts = [];
          if (h > 0) parts.push(`${h}h`);
          parts.push(`${mLeft}m`);
          closeInfo = `⏳ *Toss in:* ${parts.join(" ")}`;
        } else {
          closeInfo = "🪙 *Toss likely completed*";
        }
      } else {
        closeInfo = "⏳ *Toss time:* Unknown";
      }
    } catch (err) {
      console.warn("⚠️ [Toss Time Calc Failed]", err.message);
      closeInfo = "⏳ *Toss time:* Unknown";
    }

    const messageText = `${prefix} *${m.name}*\n📅 ${when}\n${closeInfo}`;
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
}

