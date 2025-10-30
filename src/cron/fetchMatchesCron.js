// src/cron/fetchMatchesCron.js
import cron from "node-cron";
import { fetchMatchesFromCricbuzz } from "../api/cricbuzzApi.js";
import { DateTime } from "luxon";

console.log("🕓 [Cron] Match Fetch Cron initialized.");

// 🧩 Named export for manual trigger
export async function fetchMatches() {
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`\n🕒 ${now} - 📅 Running Manual or Scheduled Match Fetch...`);
  try {
    const count = await fetchMatchesFromCricbuzz();
    console.log(`✅ [MatchFetchCron] Updated ${count} active matches.`);
    console.log("─────────────────────────────────────────────");
    return count;
  } catch (err) {
    console.error("❌ [MatchFetchCron] Error fetching matches:", err.message);
    console.log("─────────────────────────────────────────────");
    return 0;
  }
}

// 🕒 Schedule automatic run every 6 hours (IST)
cron.schedule("0 */6 * * *", fetchMatches, { timezone: "Asia/Kolkata" });
