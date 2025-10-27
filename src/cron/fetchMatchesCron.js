// src/cron/fetchMatchesCron.js
import cron from "node-cron";
import { fetchMatchesFromCricbuzz } from "../api/cricbuzzApi.js";
import { DateTime } from "luxon";

console.log("🕓 [Cron] Match Fetch Cron initialized.");

cron.schedule(
  "0 */6 * * *", // ⏱ Every 6 hours
  async () => {
    const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
    console.log(`\n🕒 ${now} - 📅 Running Scheduled Match Fetch...`);
    try {
      const count = await fetchMatchesFromCricbuzz();
      console.log(`✅ [MatchFetchCron] Updated ${count} active matches.`);
    } catch (err) {
      console.error("❌ [MatchFetchCron] Error fetching matches:", err.message);
    }
    console.log("─────────────────────────────────────────────");
  },
  { timezone: "Asia/Kolkata" }
);
