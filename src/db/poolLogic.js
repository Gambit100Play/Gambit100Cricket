// src/db/poolLogic.js
import { query } from "./db.js";
import { logger } from "../utils/logger.js";

/**
 * ============================================================
 * 🔍 getPoolInfo()
 * Aggregates pool data from bets table.
 *  - Supports: full pool or single bet option
 *  - Computes participants, total stake, unique plays
 *  - Dynamically marks pool as 'active' or 'pending'
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

  logger.info(`🎯 [getPoolInfo] match=${matchIdText}, poolType=${poolTypeClean}, betOption=${betOption || "ALL"}`);

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
        WHERE TRIM(match_id)::text = $1
          AND REPLACE(LOWER(market_type), ' ', '') = $2
          AND LOWER(TRIM(bet_option)) = LOWER(TRIM($3))
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

      logger.info(
        `📊 [getPoolInfo:Single] ${betOption}: ${participants} players, ${totalStake} G staked, status=${status}`
      );

      return {
        rows: [row],
        participants,
        totalStake,
        status,
        remaining,
        progress: Math.min(100, Math.floor((participants / minNeeded) * 100)),
        progressBar,
      };
    }

    // ============================================================
    // CASE 2 — Full match pool aggregation
    // ============================================================

    const [playersRes, playsRes, stakesRes] = await Promise.all([
      query(
        `SELECT COUNT(DISTINCT telegram_id) AS unique_players
         FROM bets
         WHERE TRIM(match_id)::text = $1
           AND REPLACE(LOWER(market_type), ' ', '') = $2`,
        [matchIdText, poolTypeClean]
      ),
      query(
        `SELECT COUNT(DISTINCT LOWER(TRIM(bet_option))) AS unique_plays
         FROM bets
         WHERE TRIM(match_id)::text = $1
           AND REPLACE(LOWER(market_type), ' ', '') = $2`,
        [matchIdText, poolTypeClean]
      ),
      query(
        `SELECT 
            LOWER(TRIM(bet_option)) AS key,
            bet_option,
            COUNT(DISTINCT telegram_id) AS participants,
            COALESCE(SUM(stake), 0) AS total_stake
         FROM bets
         WHERE TRIM(match_id)::text = $1
           AND REPLACE(LOWER(market_type), ' ', '') = $2
         GROUP BY bet_option`,
        [matchIdText, poolTypeClean]
      ),
    ]);

    const uniquePlayers = Number(playersRes.rows[0]?.unique_players || 0);
    const uniquePlays = Number(playsRes.rows[0]?.unique_plays || 0);
    let rows = stakesRes.rows || [];

    // Always include default bet options to keep the pool consistent
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

    // De-duplicate
    const seen = new Set();
    rows = rows.filter((r) => {
      const k = r.key.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Order logically
    const order = new Map(defaultOptions.map((opt, i) => [opt.toLowerCase(), i]));
    rows.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));

    // Compute overall totals
    const totalStake = rows.reduce((a, r) => a + Number(r.total_stake || 0), 0);
    const minStakeThreshold = 100; // activate if total ≥ 100 G
    const minUniquePlays = 3;

    const status =
      uniquePlays >= minUniquePlays || totalStake >= minStakeThreshold
        ? "active"
        : "pending";

    const remaining = Math.max(minNeeded - uniquePlayers, 0);
    const progressBlocks = Math.floor((uniquePlayers / minNeeded) * 10);
    const progressBar =
      "▓".repeat(progressBlocks) + "░".repeat(10 - progressBlocks);

    logger.info(
      `🏊 [getPoolInfo:Full] ${uniquePlayers} players | ${uniquePlays} plays | ${totalStake}G staked | status=${status}`
    );

    return {
      rows,
      participants: uniquePlayers,
      totalStake,
      uniquePlays,
      status,
      remaining,
      progress: Math.min(100, Math.floor((uniquePlayers / minNeeded) * 100)),
      progressBar,
    };
  } catch (err) {
    logger.error(`❌ [getPoolInfo] Failed for match ${matchId}: ${err.message}`);
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
 * 🧮 getPoolStatus()
 * Simple helper to decide pool readiness
 * ============================================================
 */
export function getPoolStatus(participants, minNeeded = 10) {
  const status = participants >= minNeeded ? "active" : "pending";
  logger.debug(`⚙️ [getPoolStatus] participants=${participants}, status=${status}`);
  return status;
}
