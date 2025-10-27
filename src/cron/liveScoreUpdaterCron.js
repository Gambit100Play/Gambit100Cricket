// src/cron/liveScoreUpdaterCron.js
import cron from "node-cron";
import fetchLiveScoresEveryTwoOvers from "../tests/LiveScoreUpdaterTest.js";
import { DateTime } from "luxon";

console.log("🕓 [Cron] Live Score Updater initialized.");

// Run every 6 minutes (slightly conservative for rate limits)
cron.schedule(
  "* 6 10 * *",
  async () => {
    console.log(`\n[${DateTime.now().toFormat("dd LLL yyyy, hh:mm a")}] - 🏏 Running 2-over live score update...\n`);
    try {
      await fetchLiveScoresEveryTwoOvers();
      console.log("✅ [Cron] 2-over Live Score Update completed.");
    } catch (err) {
      console.error("❌ [Cron] Live Score Update failed:", err.message);
    }
    console.log("───────────────────────────────");
  },
  { timezone: "Asia/Kolkata" }
);
