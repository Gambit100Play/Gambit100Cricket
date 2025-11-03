// src/cron/cleanupMatchesCron.js
import cron from "node-cron";
import {
  markOldMatchesCompleted,
  markPastDateMatchesCompleted,
  markMatchesLive, // 🧩 add this
} from "../db/db.js";
import { fetchMatches } from "./fetchMatchesCron.js";

function stamp(...args) {
  console.log(
    "🕓",
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    "-",
    ...args
  );
}

let isRunning = false;

/**
 * ▶️ Main job: fetch matches and cleanup completed ones
 * Exported so it can be called manually for testing:
 *   await runUpdate();
 */
export async function runUpdate() {
  if (isRunning) {
    stamp("⏳ Skipping — previous cycle still running.");
    return;
  }

  isRunning = true;
  stamp("▶️ Starting update cycle...");

  try {
    const count = await fetchMatches();
    stamp(`✅ Updated DB with ${count} matches.`);

    const completed6h = await markOldMatchesCompleted(6);
    stamp(`🧹 Marked ${completed6h} matches completed (>6h old).`);

    const completedPast = await markPastDateMatchesCompleted();
    stamp(`📅 Marked ${completedPast} matches completed (past date).`);
  } catch (err) {
    stamp(`❌ Update cycle failed: ${err.message}`);
  } finally {
    isRunning = false;
    stamp("🏁 Cycle complete.\n");
  }
  const count = await fetchMatches();
stamp(`✅ Updated DB with ${count} matches.`);

// 🧩 New line: update upcoming → live based on time
const wentLive = await markMatchesLive();
stamp(`📡 Marked ${wentLive} matches as LIVE (started).`);

const completed6h = await markOldMatchesCompleted(6);
stamp(`🧹 Marked ${completed6h} matches completed (>6h old).`);

const completedPast = await markPastDateMatchesCompleted();
stamp(`📅 Marked ${completedPast} matches completed (past date).`);

}

/**
 * startCleanupCron()
 * Call this once from your app bootstrap (eg. src/index.js) to start the scheduled job.
 * Cron expression below = 0 6,18 * * *  -> runs at 06:00 and 18:00 IST daily.
 */
export function startCleanupCron() {
  stamp("[CRON] Match Fetch Cron initializing...");
  // Runs at 06:00 and 18:00 Asia/Kolkata daily
  const task = cron.schedule(
    "0 6,18 * * *",
    () => {
      stamp("🔁 [CRON] Scheduled trigger");
      runUpdate();
    },
    { timezone: "Asia/Kolkata" }
  );

  // If you want it to run immediately at startup as well, uncomment:
  // runUpdate();

  return task; // returns the CronTask so you can stop()/destroy() in tests if needed
}
