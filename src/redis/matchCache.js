// ============================================================
// 🧠 Redis Match Cache (v2.1) — for matchHandler.js (Redis Safe)
// ============================================================

import redis from "./index.js";
import { query } from "../db/db.js";
import { logger } from "../utils/logger.js";

// Keys
const KEY_ALL = "matches:all";

// ------------------------------------------------------------
// 🧠 Fetch all matches from DB (fresh)
// ------------------------------------------------------------
async function fetchMatchesFromDB() {
  const { rows } = await query(`
    SELECT 
      match_id,
      name,
      team1,
      team2,
      status,
      series_name,
      match_format,
      start_time,
      venue,
      city,
      api_payload
    FROM matches
    ORDER BY start_time ASC
  `);
  return rows;
}

// ------------------------------------------------------------
// ⚡ getMatchesCached — required by matchHandler.js
// ------------------------------------------------------------
export async function getMatchesCached(ttl = 120) {
  try {
    const cached = await redis.get(KEY_ALL);

    if (cached) {
      logger.debug("⚡ [MatchCache] HIT (all matches)");
      return JSON.parse(cached);
    }

    logger.debug("🌀 [MatchCache] MISS → DB load");

    const matches = await fetchMatchesFromDB();

    // FIXED Redis syntax
    await redis.set(KEY_ALL, JSON.stringify(matches), "EX", ttl);

    return matches;
  } catch (err) {
    logger.error("❌ [MatchCache:getMatchesCached] " + err.message);
    return [];
  }
}

// ------------------------------------------------------------
// 🎯 getMatchCachedById — required by matchHandler.js
// ------------------------------------------------------------
export async function getMatchCachedById(matchId, ttl = 120) {
  const key = `match:${matchId}:info`;

  try {
    const cached = await redis.get(key);

    if (cached) {
      logger.debug(`⚡ [MatchCache] HIT (match ${matchId})`);
      return JSON.parse(cached);
    }

    logger.debug(`🌀 [MatchCache] MISS → DB load for ${matchId}`);

    const { rows } = await query(
      `SELECT * FROM matches WHERE match_id=$1 LIMIT 1`,
      [matchId]
    );

    const match = rows[0] || null;

    if (match) {
      // FIXED Redis syntax
      await redis.set(key, JSON.stringify(match), "EX", ttl);
    }

    return match;

  } catch (err) {
    logger.error("❌ [MatchCache:getMatchCachedById] " + err.message);
    return null;
  }
}

// ------------------------------------------------------------
// 🧹 invalidateMatchCache — required by matchHandler.js
// ------------------------------------------------------------
export async function invalidateMatchCache(matchId = null) {
  try {
    if (matchId) {
      await redis.del(`match:${matchId}:info`);
      logger.info(`🧹 Cleared match:${matchId}:info`);
    }

    await redis.del(KEY_ALL);
    logger.info("🧹 Cleared matches:all");

  } catch (err) {
    logger.warn(`⚠️ [MatchCache] Invalidate failed: ${err.message}`);
  }
}

// Default export
export default {
  getMatchesCached,
  getMatchCachedById,
  invalidateMatchCache
};
