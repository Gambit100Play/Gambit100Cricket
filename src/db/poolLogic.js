import { query } from "./db.js";

/**
 * 🔍 Aggregate pool info dynamically from bets table
 * - Works for full-match pool or individual bet option.
 * - Returns participants, total stake, rows per option, and progress info.
 */
export async function getPoolInfo(
  matchId,
  poolType = "PreMatch",
  betOption = null,
  minNeeded = 10
) {
  try {
    let res;

    // 🧩 Case 1: Specific bet option pool (e.g., "India to Win")
    if (betOption) {
      res = await query(
        `SELECT 
           COUNT(DISTINCT telegram_id) AS participants,
           COALESCE(SUM(stake), 0) AS total_stake
         FROM bets
         WHERE match_id = $1
           AND LOWER(market_type) = LOWER($2)
           AND bet_option = $3`,
        [matchId, poolType, betOption]
      );

      const row = res.rows[0] || { participants: 0, total_stake: 0 };
      const participants = Number(row.participants || 0);
      const totalStake = Number(row.total_stake || 0);
      const status = participants >= minNeeded ? "active" : "pending";
      const remaining = Math.max(minNeeded - participants, 0);
      const progressBlocks = Math.floor((participants / minNeeded) * 10);
      const progressBar =
        "▓".repeat(progressBlocks) + "░".repeat(10 - progressBlocks);

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

    // 🧩 Case 2: Full match pool (distinct players across all bet options)
    // ✅ FIXED: count unique telegram_ids across entire match
    const distinctRes = await query(
      `SELECT COUNT(DISTINCT telegram_id) AS unique_players
         FROM bets
        WHERE match_id = $1
          AND LOWER(market_type) = LOWER($2)`,
      [matchId, poolType]
    );
    const uniquePlayers = Number(distinctRes.rows[0]?.unique_players || 0);

    // Get per-option breakdown as well
    res = await query(
      `SELECT bet_option,
              COUNT(DISTINCT telegram_id) AS participants,
              COALESCE(SUM(stake), 0) AS total_stake
       FROM bets
       WHERE match_id = $1
         AND LOWER(market_type) = LOWER($2)
       GROUP BY bet_option`,
      [matchId, poolType]
    );

    const totalStake = res.rows.reduce(
      (a, r) => a + Number(r.total_stake || 0),
      0
    );

    const status = uniquePlayers >= minNeeded ? "active" : "pending";
    const remaining = Math.max(minNeeded - uniquePlayers, 0);
    const progressBlocks = Math.floor((uniquePlayers / minNeeded) * 10);
    const progressBar =
      "▓".repeat(progressBlocks) + "░".repeat(10 - progressBlocks);

    return {
      rows: res.rows,
      participants: uniquePlayers, // ✅ real distinct count
      totalStake,
      status,
      remaining,
      progress: Math.min(100, Math.floor((uniquePlayers / minNeeded) * 100)),
      progressBar,
    };
  } catch (err) {
    console.error("❌ [DB] getPoolInfo error:", err);
    return {
      rows: [],
      participants: 0,
      totalStake: 0,
      status: "pending",
      remaining: minNeeded,
      progress: 0,
      progressBar: "░░░░░░░░░░",
    };
  }
}

/**
 * 🧮 Pool status helper
 */
export function getPoolStatus(participants, minNeeded = 10) {
  return participants >= minNeeded ? "active" : "pending";
}
