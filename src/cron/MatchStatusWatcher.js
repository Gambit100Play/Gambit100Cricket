// ============================================================
// 🏏 MatchStatusWatcher — Smart Kickoff (v10.1 — Stable, Debounced Cache)
// ============================================================

import cron from "node-cron";
import { DateTime } from "luxon";

import { getMatchStatusSummary } from "../api/matchStatus.js";
import { startLivePoolCron } from "../cron/LiveMatchPoolGeneratorCron.js";
import { lockMatchUtility } from "../utils/lockMatchUtility.js";
import { logger } from "../utils/logger.js";
import { getNearestMatches, query } from "../db/db.js";

// Redis access
import {
  cacheGet,
  cacheSet,
  cacheDelete
} from "../redis/cache.js";

logger.info("🕒 [Cron] MatchStatusWatcher (v10.1 Stable Cache) initialized.");

// ============================================================
// 🧠 In-memory state
// ============================================================
let activeMatches = [];
const triggeredMatches = new Set();
const lastApiCallMap = new Map();
let lastRefreshTime = null;

// ============================================================
// 🔧 Redis Cache Helpers
// ============================================================
async function invalidateSingleMatch(matchId) {
  await cacheDelete(`match:${matchId}:info`);
}

async function invalidateAllMatches() {
  await cacheDelete("matches:all"); // only call from window refresh
}

async function getActiveMatchesFromCache() {
  return await cacheGet(`matches:active`);
}

async function saveActiveMatchesToCache(list) {
  await cacheSet(`matches:active`, list, 300);
}

// ============================================================
// 🔄 Refresh active matches window — ONLY place we clear full cache
// ============================================================
async function refreshActiveMatchesIfNeeded() {
  try {
    const cachedActive = await getActiveMatchesFromCache();

    // 1️⃣ First boot — fill memory from Redis
    if (!activeMatches.length && cachedActive?.length) {
      activeMatches = cachedActive;
      lastRefreshTime = DateTime.now();
      logger.info(`🧩 Loaded active window from Redis (${activeMatches.length})`);
      return;
    }

    // 2️⃣ No memory, no Redis → DB fetch
    if (!activeMatches.length) {
      const rows = await getNearestMatches(20);
      const filtered = rows
        .filter(r => !String(r.match_format || "").toLowerCase().includes("test"))
        .slice(0, 10);

      activeMatches = filtered.map(r => parseInt(String(r.match_id).replace(/^m-/, ""), 10));

      lastRefreshTime = DateTime.now();
      await saveActiveMatchesToCache(activeMatches);

      logger.info(`🧩 Initialized active window (${activeMatches.length})`);
      return;
    }

    // 3️⃣ Refresh only if:
    //    • Some match is completed OR
    //    • More than 6 hours passed
    const { rows: completed } = await query(
      `SELECT match_id FROM matches
         WHERE match_id = ANY($1)
           AND LOWER(status)='completed'`,
      [activeMatches]
    );

    const shouldRefresh =
      completed.length > 0 ||
      DateTime.now().diff(lastRefreshTime, "hours").hours >= 6;

    if (shouldRefresh) {
      const rows = await getNearestMatches(20);
      const filtered = rows
        .filter(r => !String(r.match_format || "").toLowerCase().includes("test"))
        .slice(0, 10);

      activeMatches = filtered.map(r => parseInt(String(r.match_id).replace(/^m-/, ""), 10));

      triggeredMatches.clear();
      lastRefreshTime = DateTime.now();

      await saveActiveMatchesToCache(activeMatches);

      // 🔥 ONLY place we invalidate all-matches cache
      await cacheDelete("matches:all");

      logger.info(`🔁 Window refreshed (${activeMatches.length}) — Cache invalidated ONCE`);
    }

  } catch (err) {
    logger.error(`⚠️ [refreshActiveMatchesIfNeeded] ${err.message}`);
  }
}

// ============================================================
// 🧭 Core Cron Loop — runs every minute
// ============================================================
cron.schedule("*/1 * * * *", async () => {
  const nowIST = DateTime.now().setZone("Asia/Kolkata");

  logger.info(`\n[MatchStatusWatcher] Tick → ${nowIST.toFormat("dd LLL yyyy, hh:mm:ss a")}`);

  try {
    await refreshActiveMatchesIfNeeded();

    if (!activeMatches.length) {
      logger.info("📭 No active matches to monitor.");
      return;
    }

    // Load active matches from DB
    const { rows: matches } = await query(
      `SELECT * FROM matches
         WHERE match_id = ANY($1)
           AND LOWER(match_format) NOT LIKE '%test%'
       ORDER BY start_time ASC`,
      [activeMatches]
    );

    if (!matches.length) {
      logger.info("📭 No limited-overs matches found for window.");
      return;
    }

    // ============================================================
    // ⚡ AUTO-LIVE RECOVERY (NO FULL INVALIDATION)
    // ============================================================
    for (const m of matches) {
      const mid = parseInt(String(m.match_id).replace(/^m-/, ""), 10);
      if (!mid || triggeredMatches.has(mid)) continue;

      const dbStatus = (m.status || "").toLowerCase();
      const liveLike = ["live", "in progress", "1st innings", "2nd innings"];

      if (liveLike.includes(dbStatus)) {
        const label = `[${m.match_id}] ${m.team1} vs ${m.team2}`;
        logger.info(`⚡ [AUTO-LIVE] ${label} → Starting pools...`);

        await lockMatchUtility(m);

        await query(
          `UPDATE matches
             SET status='locked_pre',
                 prematch_locked=true,
                 prematch_locked_at=NOW(),
                 updated_at=NOW()
           WHERE match_id=$1`,
          [mid]
        );

        // 🔥 Only delete this match’s cache — NOT the whole list
        await invalidateSingleMatch(mid);

        await startLivePoolCron(mid);
        triggeredMatches.add(mid);

        logger.info(`🚀 [AUTO-LIVE] ${label} → Pools started.`);
      }
    }

    // ============================================================
    // 🕒 Kickoff detection — checks API and locks match
    // ============================================================
    for (const match of matches) {
      const matchId = parseInt(String(match.match_id).replace(/^m-/, ""), 10);
      if (!matchId) continue;

      if (triggeredMatches.has(matchId)) continue;

      const now = DateTime.now().setZone("Asia/Kolkata");
      const matchStart = DateTime.fromISO(String(match.start_time)).setZone("Asia/Kolkata");
      const minsToStart = matchStart.diff(now, "minutes").minutes;
      const minsSinceStart = now.diff(matchStart, "minutes").minutes;

      const label = `[${match.match_id}] ${match.team1} vs ${match.team2}`;

      if (minsToStart > 15) continue;
      if (minsToStart > 0) continue;

      if (minsSinceStart >= 0 && minsSinceStart < 60) {

        const lastCall = lastApiCallMap.get(matchId);
        if (lastCall && now.diff(lastCall, "minutes").minutes < 10) continue;

        lastApiCallMap.set(matchId, now);

        logger.info(`📡 ${label} → Checking kickoff API...`);

        try {
          const { state } = await getMatchStatusSummary(matchId);
          const normalized = (state || "").toLowerCase();

          const liveLike = ["live", "in progress", "1st innings", "2nd innings"];

          if (liveLike.includes(normalized)) {
            logger.info(`🔥 ${label} LIVE → Locking & starting pools.`);

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

            // 🔥 Only clear this match from cache
            await invalidateSingleMatch(matchId);

            await startLivePoolCron(matchId);
            triggeredMatches.add(matchId);

            logger.info(`🚀 ${label} Pools started.`);
          }
        } catch (err) {
          logger.error(`❌ ${label} API error: ${err.message}`);
        }
      }
    }

  } catch (err) {
    logger.error(`🚨 [MatchStatusWatcher] Fatal: ${err.message}`);
  }

  logger.info("──────────────────────────────────────────────");
});
