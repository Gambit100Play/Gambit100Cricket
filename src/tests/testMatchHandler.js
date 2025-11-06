/**
 * 🧪 Local Test Runner for matchHandler.dev.js
 * --------------------------------------------
 * Fully offline Telegram simulation (no API calls)
 * Run with:
 *    node src/tests/testMatchHandlerLocal.js
 * Add --step flag to pause between steps
 */

import { Telegraf } from "telegraf";
import matchHandler from "../developing/matchHandler.dev.js";
import { DateTime } from "luxon";

const stepMode = process.argv.includes("--step");

// ──────────────────────────────────────────────
// 🧩 Mock DB layer (replace actual imports)
// ──────────────────────────────────────────────
export const getMatches = async () => [
  {
    id: "m001",
    match_id: 136137,
    name: "India vs Australia",
    series_name: "ICC T20 World Cup 2025",
    match_desc: "12th Match",
    match_format: "T20",
    start_time: new Date(Date.now() + 1000 * 60 * 90).toISOString(),
    start_date: "2025-11-06",
    start_time_local: "19:30:00",
    status: "scheduled",
    team1: "India",
    team2: "Australia",
    venue: "Wankhede Stadium",
    city: "Mumbai",
    country: "India",
    prematch_locked: false,
    prematch_locked_at: null,
    tron_txid: "3d6af9128f4f77e7bb0a22ab1234abcd",
    api_payload: { tossResults: null, score: [] },
  },
  {
    id: "m002",
    match_id: 136138,
    name: "England vs Pakistan",
    series_name: "Bilateral Series 2025",
    match_desc: "2nd ODI",
    match_format: "ODI",
    start_time: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    status: "live",
    team1: "England",
    team2: "Pakistan",
    venue: "Lord's",
    city: "London",
    country: "England",
    prematch_locked: true,
    prematch_locked_at: new Date(),
    tron_txid: "a1b2c3d4e5f678901234abcd5678efgh",
    api_payload: {
      tossResults: { tossWinnerName: "Pakistan", decision: "bowl" },
      score: [
        { inning: "England 1st Innings", r: 256, w: 7, o: 45.3 },
        { inning: "Pakistan 1st Innings", r: 128, w: 3, o: 22.1 },
      ],
    },
  },
];

export const getMatchById = async (id) =>
  (await getMatches()).find((m) => m.id === id);

// ──────────────────────────────────────────────
// 🧩 Mock Telegram context (used for ctx.reply etc.)
// ──────────────────────────────────────────────
function createMockCtx() {
  return {
    from: { id: 999999, language_code: "en" },
    reply: async (msg, opts = {}) => {
      console.log("\n📤 [TELEGRAM REPLY]");
      console.log("──────────────────────────────");
      console.log(msg);
      if (opts?.reply_markup)
        console.log("Keyboard:", opts.reply_markup.inline_keyboard);
    },
    answerCbQuery: async (txt) =>
      txt && console.log(`🔘 CallbackQuery: ${txt}`),
  };
}

// ──────────────────────────────────────────────
// 🧩 Step helper for --step flag
// ──────────────────────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function stepPause() {
  if (!stepMode) return;
  console.log("⏸ Press Enter to continue...");
  process.stdin.setRawMode(true);
  await new Promise((resolve) =>
    process.stdin.once("data", () => {
      process.stdin.setRawMode(false);
      resolve();
    })
  );
}

// ──────────────────────────────────────────────
// 🧩 Simulate Bot + Handler
// ──────────────────────────────────────────────
async function runTest() {
  const start = Date.now();
  console.log("🚀 [Test] Initializing mock Telegram bot…");

  const bot = new Telegraf("FAKE_TOKEN_FOR_TEST");

  // 🔒 Prevent real Telegram API calls
  bot.telegram.callApi = async (method, payload) => {
    console.log(`🧩 [Mock API] ${method}`, payload || "");
    return {};
  };

  // Attach the dev handler
  matchHandler(bot);

  const ctx = createMockCtx();

  console.log("\n===========================================");
  console.log("🧪 TEST #1 — User opens Matches list");
  console.log("===========================================");

  await bot.handleUpdate(
    { callback_query: { data: "matches", from: ctx.from } },
    ctx
  );

  await stepPause();

  console.log("\n===========================================");
  console.log("🧪 TEST #2 — User clicks Predict on live match");
  console.log("===========================================");

  await bot.handleUpdate(
    { callback_query: { data: "predict_m002", from: ctx.from } },
    ctx
  );

  await stepPause();

  console.log("\n===========================================");
  console.log("🧪 TEST #3 — User clicks Predict on upcoming match");
  console.log("===========================================");

  await bot.handleUpdate(
    { callback_query: { data: "predict_m001", from: ctx.from } },
    ctx
  );

  console.log("\n✅ All tests executed successfully.");
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(
    `🕒 Local Test Finished — ${DateTime.now()
      .setZone("Asia/Kolkata")
      .toFormat("dd LLL yyyy, hh:mm a")} (${elapsed}s)`
  );
}

runTest().catch((err) => {
  console.error("❌ Test failed:");
  console.error("Message:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
});
