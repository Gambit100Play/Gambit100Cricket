// ============================================================
// 🏏 MatchStatusWatcher — Unified Countdown + Live Sentinel (v8.2)
// ============================================================
//
// • Handles both matches that *just went live* AND ones already live in DB
// • Ensures every live match gets locked_pre + LivePoolCron started
// ============================================================

import cron from "node-cron";
import { DateTime } from "luxon";
import { getNearestMatches, query } from "../db/db.js";
import { getMatchStatusSummary } from "../api/matchStatus.js";
import { startLivePoolCron } from "../cron/LiveMatchPoolGeneratorCron.js";
import { lockMatchUtility } from "../utils/lockMatchUtility.js";
import { logger } from "../utils/logger.js";

logger.info("🕒 [Cron] MatchStatusWatcher (v8.2) initialized.");

const triggeredMatches = new Set();
const lastApiCallMap = new Map();

cron.schedule("*/1 * * * *", async () => {
  const nowIST = DateTime.now().setZone("Asia/Kolkata");
  logger.info(`\n[MatchStatusWatcher] Tick → ${nowIST.toFormat("dd LLL yyyy, hh:mm:ss a")}`);

  try {
    const matches = await getNearestMatches(10);
    if (!matches.length) {
      logger.info("✅ No matches to monitor.");
      return;
    }

    for (const match of matches) {
      const matchId = parseInt(String(match.match_id || "").replace(/^m-/, ""), 10);
      if (!matchId) continue;

      const label = `[${match.match_id}] ${match.team1 || "Team A"} vs ${match.team2 || "Team B"}`;
      const status = (match.status || "").toLowerCase();

      // 🧠 skip already processed matches
      if (triggeredMatches.has(matchId)) continue;

      // ============================================================
      // 🧩 CASE 1 — Already LIVE in DB
      // ============================================================
      if (["live", "in progress"].includes(status)) {
        logger.info(`🔥 ${label} Already LIVE in DB → Ensuring locked_pre & LivePoolCron...`);
        try {
          // 1️⃣ lock pre-match if not locked
          await query(
            `UPDATE matches
               SET status='locked_pre',
                   prematch_locked = TRUE,
                   prematch_locked_at = COALESCE(prematch_locked_at, NOW()),
                   updated_at = NOW()
             WHERE match_id=$1
               AND (prematch_locked IS FALSE OR prematch_locked IS NULL)
             RETURNING match_id`,
            [matchId]
          );

          // 2️⃣ start live pool cron (idempotent)
          await startLivePoolCron(matchId);
          logger.info(`🚀 [${matchId}] Live Pool Generator started (DB-live).`);

          triggeredMatches.add(matchId);
          logger.info(`🛑 ${label} Watcher stopped for this match.`);
        } catch (err) {
          logger.error(`❌ ${label} DB-live branch failed: ${err.message}`);
        }
        continue;
      }

      // ============================================================
      // 🧩 CASE 2 — Upcoming (Countdown & Poll)
      // ============================================================
      const matchStart = DateTime.fromISO(String(match.start_time)).setZone("Asia/Kolkata");
      const minsToStart = matchStart.diff(nowIST, "minutes").minutes;

      if (minsToStart > 1) {
        logger.info(`🕓 ${label} Starts in ${Math.round(minsToStart)} min`);
        continue;
      }

      // poll every 30 min
      const lastCall = lastApiCallMap.get(matchId);
      const minsSinceLast = lastCall ? nowIST.diff(lastCall, "minutes").minutes : Infinity;
      if (minsSinceLast < 30) continue;
      lastApiCallMap.set(matchId, nowIST);

      logger.info(`📡 ${label} Checking live state from API...`);
      try {
        const { state } = await getMatchStatusSummary(matchId);
        const normalizedState = (state || "").toLowerCase();

        if (["in progress", "live", "1st innings", "2nd innings"].includes(normalizedState)) {
          logger.info(`🔥 ${label} Match went LIVE → locking pre-match + triggering pools...`);

          await lockMatchUtility(match);
          await query(
            `UPDATE matches
               SET status='locked_pre',
                   prematch_locked=true,
                   prematch_locked_at=NOW(),
                   updated_at=NOW()
             WHERE match_id=$1`,
            [matchId]
          );

          await startLivePoolCron(matchId);
          logger.info(`🚀 ${label} Live Pool Generator started for match ${matchId}`);
          triggeredMatches.add(matchId);
          logger.info(`🛑 ${label} Watcher stopped.`);
        } else {
          logger.info(`🕓 ${label} Still ${normalizedState || "upcoming"}`);
        }
      } catch (err) {
        logger.error(`❌ ${label} Status API failed: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`🚨 [MatchStatusWatcher] Fatal: ${err.message}`);
  }

  logger.info("──────────────────────────────────────────────");
});
