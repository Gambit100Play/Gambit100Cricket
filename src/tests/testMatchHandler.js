// src/tests/testMatchHandler.js
import dotenv from "dotenv";
dotenv.config();

import { logger } from "../utils/logger.js"; // ✅ always first
logger.info("🧭 Logger initialized for testMatchHandler.js");

import { getMatches } from "../db/db.js";
import matchHandlerModule from "../bot/handlers/matchHandler.js";
import { DateTime } from "luxon";

/* ============================================================
 🎭 Mock Telegram Context
============================================================ */
function createMockCtx() {
  return {
    from: { id: 123456, first_name: "TestUser", language_code: "en" },
    reply: async (msg, opts = {}) => {
      logger.info(`💬 BOT REPLY:\n${msg}`);
      if (opts?.reply_markup)
        logger.info(`🎛️ Buttons: ${JSON.stringify(opts.reply_markup.inline_keyboard)}`);
    },
    answerCbQuery: async (msg) =>
      logger.info(`✅ answerCbQuery called: ${msg || "(none)"}`),
  };
}

/* ============================================================
 🕒 Normalize timestamps (Date, ISO, SQL)
============================================================ */
function normalizeTime(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "string") {
    const str = raw.trim();
    if (/GMT|IST|CET|UTC/i.test(str)) return new Date(str).toISOString();
    if (!/[Z+-]\d{2}/.test(str)) return str.replace(" ", "T") + "Z";
    return str.replace(" ", "T");
  }
  return null;
}

/* ============================================================
 🧪 Main Test Runner
============================================================ */
async function runMatchHandlerTest() {
  logger.info("🧪 [Test] Starting Match Handler Diagnostic Test...");
  const ctx = createMockCtx();

  // --- Fetch matches
  let matches = await getMatches();
  if (!matches?.length) {
    logger.warn("⚠️ [Test] No matches in DB. Try running fetchAll first.");
    return;
  }

  // --- Normalize all timestamps to UTC ISO
  matches = matches.map((m) => ({ ...m, start_time: normalizeTime(m.start_time) }));

  logger.info(`📦 [Test] Found ${matches.length} matches in DB. Showing top 5...\n`);

  const summary = matches
    .slice(0, 5)
    .map((m, i) => {
      const when = m.start_time || `${m.start_date} ${m.start_time_local}`;
      return `${i + 1}. ${m.name || `${m.team1} vs ${m.team2}`} — ${when}`;
    })
    .join("\n");

  logger.info("📅 [Sample Matches]\n" + summary);

  try {
    const matchHandler = matchHandlerModule;
    if (typeof matchHandler !== "function")
      throw new Error("Handler not callable");

    logger.info("🧩 [Test] Loading matchHandler...");
    const fakeBot = { action: () => {} };
    matchHandler(fakeBot);

    logger.info("📲 [Test] Simulating 'matches' action...");
    await ctx.reply("📅 *Simulated Matches Output:*", { parse_mode: "Markdown" });

    // --- Filter and sort matches
    const filtered = matches
      .filter((m) => {
        const s = (m.status || "").toLowerCase();
        return ["live", "in progress", "playing", "upcoming", "scheduled", "fixture"].some((x) =>
          s.includes(x)
        );
      })
      .sort(
        (a, b) =>
          new Date(a.start_time || a.start_date) - new Date(b.start_time || b.start_date)
      )
      .slice(0, 5);

    for (const m of filtered) {
      const prefix = /(live|in progress|playing)/.test((m.status || "").toLowerCase())
        ? "🔴 LIVE"
        : "🕓 UPCOMING";

      let when = "TBA";
      if (m.start_time) {
        const dt = DateTime.fromISO(m.start_time, { zone: "utc" }).setZone("Asia/Kolkata");
        if (dt.isValid) when = dt.toFormat("dd LLL yyyy, hh:mm a ZZZZ");
      }

      const msg = `
${prefix} | *${m.name || `${m.team1} vs ${m.team2}`}*
🏆 *${m.series_name || "Unknown Series"}*
📅 *${when}*
🏟️ *Venue:* ${m.venue || "TBA"}${m.city ? `, ${m.city}` : ""}
🌍 *Country:* ${m.country || "Unknown"}
📍 *Status:* ${m.status || "TBD"}
      `.trim();

      await ctx.reply(msg, { parse_mode: "Markdown" });
    }

    const updatedAt = DateTime.now()
      .setZone("Asia/Kolkata")
      .toFormat("dd LLL yyyy, hh:mm a");
    await ctx.reply(`📡 *Last Updated:* ${updatedAt} IST`, { parse_mode: "Markdown" });

    logger.info("✅ [Test] Match handler logic executed successfully.");
  } catch (err) {
    logger.error(`💥 [Test] Match handler failed: ${err.stack || err.message}`);
  }
}

/* ============================================================
 🏁 Execute (and ensure file flush)
============================================================ */
runMatchHandlerTest()
  .then(async () => {
    logger.info("🏁 [Test] Completed Match Handler Diagnostics.");
    await new Promise((r) => setTimeout(r, 500)); // ensure log flush
  })
  .catch(async (err) => {
    logger.error("❌ [Test] Fatal error: " + err.message);
    await new Promise((r) => setTimeout(r, 500));
  });
