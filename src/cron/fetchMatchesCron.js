import cron from "node-cron";
import { ensureUpcomingMatches } from "../api/fetchAllMatches.js";
import { DateTime } from "luxon";
import { logger } from "../utils/logger.js";

console.log("🕓 [Cron] Match Fetch Cron initialized.");

export async function fetchMatches() {
  const now = DateTime.now()
    .setZone("Asia/Kolkata")
    .toFormat("dd LLL yyyy, hh:mm a");

  const headline = `🕒 ${now} - 📅 Running Manual or Scheduled Match Fetch...`;
  console.log(headline);
  logger.info(headline);

  try {
    await ensureUpcomingMatches();
    logger.info("✅ [MatchFetchCron] Fetch completed successfully.");
  } catch (err) {
    const msg = `❌ [MatchFetchCron] Error fetching matches: ${err.message}`;
    console.error(msg);
    logger.error(msg);
  }
}

// Run every 6 hours
cron.schedule("0 6 * * *", fetchMatches, { timezone: "Asia/Kolkata" });
