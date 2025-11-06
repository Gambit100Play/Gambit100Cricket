import cron from "node-cron";
import { ensureUpcomingMatches } from "../api/fetchAllMatches.js";
import { DateTime } from "luxon";
import { logger } from "../utils/logger.js";

const TZ = "Asia/Kolkata";
const CRON_EXPR = "0 */6 * * *"; // every 6 hours (00, 06, 12, 18)

console.log("🕓 [Cron] Match Fetch Cron initialized.");
logger.info({
  msg: "Match Fetch Cron initialized",
  cron: CRON_EXPR,
  timezone: TZ,
  env: process.env.NODE_ENV || "development",
  pid: process.pid,
});

let isRunning = false; // overlap guard

export async function fetchMatches() {
  if (isRunning) {
    logger.warn({
      msg: "Fetch skipped: previous run still in progress",
      reason: "overlap_guard",
      pid: process.pid,
    });
    return;
  }

  const startTs = Date.now();
  isRunning = true;

  const nowDisplay = DateTime.now().setZone(TZ).toFormat("dd LLL yyyy, hh:mm a");
  const headline = `🕒 ${nowDisplay} - 📅 Running Manual or Scheduled Match Fetch...`;

  console.log(headline);
  logger.info({
    msg: "Fetch started",
    headline,
    pid: process.pid,
    when_ist: nowDisplay,
  });

  try {
    // If ensureUpcomingMatches() can return summary, capture it; else we’ll log generic success.
    const summary = await ensureUpcomingMatches();

    const durationMs = Date.now() - startTs;
    const mem = process.memoryUsage();
    logger.info({
      msg: "MatchFetchCron completed successfully",
      duration_ms: durationMs,
      summary: summary ?? "no-summary",
      memory_mb: {
        rss: Math.round(mem.rss / 1_048_576),
        heapTotal: Math.round(mem.heapTotal / 1_048_576),
        heapUsed: Math.round(mem.heapUsed / 1_048_576),
        external: Math.round(mem.external / 1_048_576),
      },
    });
    console.log("✅ [MatchFetchCron] Fetch completed successfully.");
  } catch (err) {
    const durationMs = Date.now() - startTs;
    logger.error({
      msg: "MatchFetchCron error",
      error: err?.message,
      stack: err?.stack,
      duration_ms: durationMs,
    });
    console.error(`❌ [MatchFetchCron] Error fetching matches: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

// Start the cron task
const task = cron.schedule(CRON_EXPR, fetchMatches, { timezone: TZ });

// Optional: start-up ping to confirm scheduling
logger.info({
  msg: "MatchFetchCron scheduled",
  cron: CRON_EXPR,
  timezone: TZ,
  status: "started",
});

// Optional: expose a manual trigger function (e.g., for CLI/tests)
export async function runNow() {
  logger.info({ msg: "Manual trigger invoked for MatchFetchCron" });
  await fetchMatches();
}
