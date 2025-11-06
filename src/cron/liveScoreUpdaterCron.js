// ============================================================
// 🕒 Live Score Updater Cron — runs every 6 minutes
// ============================================================

import cron from "node-cron";
import { fetchLiveScoresEveryTwoOvers } from "../tests/LiveScoreUpdaterTest.js";  // ✅ FIXED IMPORT
import { DateTime } from "luxon";

console.log("🕓 [Cron] Live Score Updater initialized.");

// ✅ Specify the match ID you want to track
const TARGET_MATCH_ID = "133248"; // e.g. UAE vs USA (LIVE)

// 🕒 Run every 6 minutes (change */6 to */3 for 3-minute updates)
cron.schedule(
  "*/6 * * * *",
  async () => {
    const now = DateTime.now().setZone("Asia/Kolkata");
    console.log(
      `\n[${now.toFormat("dd LLL yyyy, hh:mm a")}] 🏏 Fetching live score for Match ID: ${TARGET_MATCH_ID}...\n`
    );

    try {
      // 👇 Pass the specific matchId to your fetch function
      await fetchLiveScoresEveryTwoOvers(TARGET_MATCH_ID);
      console.log(`✅ [Cron] Live Score Update completed for Match ${TARGET_MATCH_ID}`);
    } catch (err) {
      console.error(`❌ [Cron] Live Score Update failed for Match ${TARGET_MATCH_ID}:`, err.message);
    }

    console.log("───────────────────────────────");
  },
  { timezone: "Asia/Kolkata" }
);
