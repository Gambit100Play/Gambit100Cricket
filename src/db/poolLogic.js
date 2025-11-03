import { query } from "./db.js";

/**
 * 🔍 Aggregate pool info dynamically from bets table
 * Handles:
 *   - Specific bet option
 *   - Full pool (all bet options)
 *   - Dynamic activation based on unique plays OR total stake
 */
export async function getPoolInfo(
  matchId,
  poolType = "PreMatch",
  betOption = null,
  minNeeded = 10
) {
  try {
    const matchIdText = String(matchId).trim();
    const poolTypeClean = poolType.replace(/\s+/g, "").toLowerCase();

    // -------------------------------
    // 🎯 CASE 1 — Single bet option
    // -------------------------------
    if (betOption) {
      const res = await query(
        `SELECT 
           COUNT(DISTINCT telegram_id) AS participants,
           COALESCE(SUM(stake), 0) AS total_stake
         FROM bets
         WHERE TRIM(match_id)::text = $1
           AND REPLACE(LOWER(market_type), ' ', '') = $2
           AND LOWER(TRIM(bet_option)) = LOWER(TRIM($3))`,
        [matchIdText, poolTypeClean, betOption]
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

    // -------------------------------
    // 🎯 CASE 2 — Full match pool
    // -------------------------------
    const [playersRes, distinctRes, stakeRes] = await Promise.all([
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
    const uniquePlays = Number(distinctRes.rows[0]?.unique_plays || 0);
    let rows = stakeRes.rows || [];

    // -------------------------------
    // 🧩 Always include default options
    // -------------------------------
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

    // 🧹 De-duplicate and preserve only one record per key
    const seen = new Set();
    rows = rows.filter((r) => {
      const k = r.key.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // 🧮 Order the rows logically
    const order = new Map(defaultOptions.map((opt, i) => [opt.toLowerCase(), i]));
    rows.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));

    // -------------------------------
    // ⚙️ Compute pool status
    // -------------------------------
    const totalStake = rows.reduce((a, r) => a + Number(r.total_stake || 0), 0);
    const minStakeThreshold = 100; // activate if total >= 100 G
    const minUniquePlays = 3;

    const status =
      uniquePlays >= minUniquePlays || totalStake >= minStakeThreshold
        ? "active"
        : "pending";

    const remaining = Math.max(minNeeded - uniquePlayers, 0);
    const progressBlocks = Math.floor((uniquePlayers / minNeeded) * 10);
    const progressBar =
      "▓".repeat(progressBlocks) + "░".repeat(10 - progressBlocks);

    // -------------------------------
    // 🧾 Return aggregated data
    // -------------------------------
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
    console.error("❌ [DB] getPoolInfo error:", err.message);
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
 * 🧮 Pool status helper
 */
export function getPoolStatus(participants, minNeeded = 10) {
  return participants >= minNeeded ? "active" : "pending";
}
