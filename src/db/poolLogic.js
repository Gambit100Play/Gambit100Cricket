// src/db/poolLogic.js
import { query } from "./db.js";
import { logger } from "../utils/logger.js";
import poolCache from "../redis/poolCache.js";   // ✅ Correct cache module

/**
 * ============================================================
 * 🔍 getPoolInfo() — now using Redis caching (2 sec TTL)
 * ============================================================
 */
export async function getPoolInfo(
  matchId,
  poolType = "PreMatch",
  betOption = null,
  minNeeded = 10
) {
  const matchIdText = String(matchId).trim();
  const poolTypeClean = poolType.replace(/\s+/g, "").toLowerCase();

  const cacheKey = betOption
    ? `poolinfo:${matchIdText}:${poolTypeClean}:${betOption}`
    : `poolinfo:${matchIdText}:${poolTypeClean}`;

  // ============================================================
  // 🔥 Try Redis cache first (via poolCache.js)
  // ============================================================
  const cached = await poolCache.poolCacheGet(cacheKey);
  if (cached) {
    logger.debug(`⚡ [PoolCacheHit] ${cacheKey}`);
    return cached;               // already parsed JSON
  }

  logger.info(
    `🎯 [getPoolInfo] match=${matchIdText}, poolType=${poolTypeClean}, betOption=${betOption || "ALL"}`
  );

  try {
    // ============================================================
    // CASE 1 — Single bet option
    // ============================================================
    if (betOption) {
      const sql = `
        SELECT 
          COUNT(DISTINCT telegram_id) AS participants,
          COALESCE(SUM(stake), 0) AS total_stake
        FROM bets
        WHERE match_id::text = $1
          AND REPLACE(LOWER(market_type), ' ', '') = $2
          AND LOWER(TRIM(bet_option::text)) = LOWER(TRIM($3))
          AND LOWER(status) NOT IN ('cancelled', 'voided')
      `;
      const res = await query(sql, [matchIdText, poolTypeClean, betOption]);
      const row = res.rows[0] || { participants: 0, total_stake: 0 };

      const participants = Number(row.participants || 0);
      const totalStake = Number(row.total_stake || 0);

      const status = participants >= minNeeded ? "active" : "pending";
      const remaining = Math.max(minNeeded - participants, 0);
      const progressBlocks = Math.floor((participants / minNeeded) * 10);
      const progressBar =
        "▓".repeat(progressBlocks) + "░".repeat(10 - progressBlocks);

      const data = {
        rows: [row],
        participants,
        totalStake,
        status,
        remaining,
        progress: Math.min(100, Math.floor((participants / minNeeded) * 100)),
        progressBar,
      };

      // Cache using poolCache.js
      await poolCache.poolCacheSet(cacheKey, data, 2);
      return data;
    }

    // ============================================================
    // CASE 2 — Full pool aggregation
    // ============================================================
    const [playersRes, playsRes, stakesRes] = await Promise.all([
      query(
        `SELECT COUNT(DISTINCT telegram_id) AS unique_players
         FROM bets
         WHERE match_id::text = $1
           AND REPLACE(LOWER(market_type), ' ', '') = $2
           AND LOWER(status) NOT IN ('cancelled', 'voided')`,
        [matchIdText, poolTypeClean]
      ),

      query(
        `SELECT COUNT(DISTINCT LOWER(TRIM(bet_option::text))) AS unique_plays
         FROM bets
         WHERE match_id::text = $1
           AND REPLACE(LOWER(market_type), ' ', '') = $2
           AND LOWER(status) NOT IN ('cancelled', 'voided')`,
        [matchIdText, poolTypeClean]
      ),

      query(
        `SELECT 
            LOWER(TRIM(bet_option::text)) AS key,
            bet_option,
            COUNT(DISTINCT telegram_id) AS participants,
            COALESCE(SUM(stake), 0) AS total_stake
         FROM bets
         WHERE match_id::text = $1
           AND REPLACE(LOWER(market_type), ' ', '') = $2
           AND LOWER(status) NOT IN ('cancelled', 'voided')
         GROUP BY bet_option`,
        [matchIdText, poolTypeClean]
      ),
    ]);

    const uniquePlayers = Number(playersRes.rows[0]?.unique_players || 0);
    const uniquePlays = Number(playsRes.rows[0]?.unique_plays || 0);
    let rows = stakesRes.rows || [];

    // Add baseline options
    const defaultOptions = [
      "Team A to Win",
      "Team B to Win",
      "Draw / Tie",
      "Over 300 Runs",
      "Under 300 Runs",
    ];

    const existingKeys = new Set(rows.map((r) => r.key));

    for (const opt of defaultOptions) {
      const key = opt.toLowerCase().trim();
      if (!existingKeys.has(key)) {
        rows.push({ key, bet_option: opt, participants: 0, total_stake: 0 });
      }
    }

    rows = rows.filter((r, i, arr) => arr.findIndex(a => a.key === r.key) === i);

    const totalStake = rows.reduce((a, r) => a + Number(r.total_stake || 0), 0);

    const minStakeThreshold = 100;
    const minUniquePlays = 3;

    const status =
      uniquePlays >= minUniquePlays || totalStake >= minStakeThreshold
        ? "active"
        : "pending";

    const remaining = Math.max(minNeeded - uniquePlayers, 0);
    const progressBlocks = Math.floor((uniquePlayers / minNeeded) * 10);
    const progressBar =
      "▓".repeat(progressBlocks) + "░".repeat(10 - progressBlocks);

    const data = {
      rows,
      participants: uniquePlayers,
      totalStake,
      uniquePlays,
      status,
      remaining,
      progress: Math.min(100, Math.floor((uniquePlayers / minNeeded) * 100)),
      progressBar,
    };

    // Cache result
    await poolCache.poolCacheSet(cacheKey, data, 2);
    return data;

  } catch (err) {
    logger.error(`❌ [getPoolInfo] Failed: ${err.message}`);
    return {
      rows: [],
      participants: 0,
      totalStake: 0,
      uniquePlays: 0,
      status: "pending",
      remaining: minNeeded,
      progress: 0,
      progressBar: "░░░░░░░░░░",
    };
  }
}


/**
 * ============================================================
 * 🧮 getPoolStatus() — Cached (local + Redis)
 * ============================================================
 */
const localStatusCache = new Map();

export async function getPoolStatus(participants, minNeeded = 10) {
  const key = `poolstatus:${participants}:${minNeeded}`;

  // 1️⃣ Local cache (fastest)
  if (localStatusCache.has(key)) {
    return localStatusCache.get(key);
  }

  // 2️⃣ Redis global cache
  const cached = await poolCache.poolCacheGet(key);
  if (cached) {
    localStatusCache.set(key, cached);
    return cached;
  }

  // 3️⃣ Fresh compute
  const status = participants >= minNeeded ? "active" : "pending";

  logger.debug(`⚙️ [getPoolStatus] participants=${participants}, status=${status}`);

  // 4️⃣ Save into both caches
  localStatusCache.set(key, status);
  await poolCache.poolCacheSet(key, status, 2);

  return status;
}
