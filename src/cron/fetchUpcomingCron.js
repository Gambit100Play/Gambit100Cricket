import cron from "node-cron";
import { ensureUpcomingMatches } from "../api/fetchUpcomingMatches.js";

/**
 * 🕒 CRON JOB: Ensure upcoming matches are always available in DB
 * Runs every 30 minutes.
 */
export function startFetchUpcomingCron() {
  console.log("🕓 [CRON] Starting fetchUpcomingCron...");

  // Runs every 30 minutes
  cron.schedule("* * * * *", async () => {
    console.log("🔁 [CRON] Checking DB for live/upcoming matches...");
    await ensureUpcomingMatches();
  });
}
