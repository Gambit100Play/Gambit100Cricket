// ============================================================
// 💰 Payouts Handler — Unified for PreMatch and Live Micro Pools
// ============================================================

import { pool } from "../db/db.js";
import { logger } from "../utils/logger.js";
import { publishHashToTron } from "../utils/tronPublisher.js"; // Optional — for blockchain proof
import { DateTime } from "luxon";

/**
 * 📦 handlePoolPayout
 * Handles payouts for *any* pool type.
 *
 * @param {Object} options
 * @param {number} options.matchId        - Match ID
 * @param {string} options.poolType       - "PREMATCH" | "LIVE"
 * @param {string} options.poolCategory   - e.g., "winner", "score", "boundaries"
 * @param {number} options.microRange     - (optional) live pool range, e.g., "2-4 overs"
 * @param {string} options.resultOptionId - The ID of the winning option
 */
export async function handlePoolPayout({
  matchId,
  poolType,
  poolCategory,
  microRange = null,
  resultOptionId,
}) {
  const client = await pool.connect();
  const startTime = DateTime.now().toISO();
  const label = poolType === "LIVE" ? `Live-${microRange}` : "PreMatch";

  logger.info(
    `🏁 [PayoutsHandler] Starting payout for ${label} pool | match=${matchId} | category=${poolCategory}`
  );

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch locked pool info
    const { rows: pools } = await client.query(
      `SELECT id, total_stake, pool_json, participants
       FROM pools
       WHERE match_id = $1 AND pool_type = $2 AND category = $3 AND is_locked = true`,
      [matchId, poolType, poolCategory]
    );

    if (pools.length === 0) {
      logger.warn(`⚠️ [PayoutsHandler] No locked ${label} pool found.`);
      await client.query("ROLLBACK");
      return;
    }

    const poolData = pools[0];
    const { total_stake, pool_json, participants } = poolData;
    const options = pool_json.options; // e.g. [{id:'A',text:'India Win',bets:1200}, ...]

    // 2️⃣ Identify winning option
    const winner = options.find((opt) => opt.id === resultOptionId);
    if (!winner) {
      logger.error(`🚨 [PayoutsHandler] Winning option ${resultOptionId} not found.`);
      await client.query("ROLLBACK");
      return;
    }

    // 3️⃣ Calculate payout ratio
    const totalWinningStake = winner.bets || 1; // prevent div-by-zero
    const payoutRatio = total_stake / totalWinningStake;

    logger.info(
      `💸 [PayoutsHandler] Winner="${winner.text}" | Ratio=${payoutRatio.toFixed(2)}x`
    );

    // 4️⃣ Fetch all users who bet on that option
    const { rows: winners } = await client.query(
      `SELECT user_id, bet_amount FROM bets
       WHERE match_id = $1 AND pool_type = $2 AND category = $3
       AND option_id = $4`,
      [matchId, poolType, poolCategory, resultOptionId]
    );

    if (winners.length === 0) {
      logger.info("😶 [PayoutsHandler] No winners in this pool.");
      await archivePool(client, matchId, poolType, poolCategory, resultOptionId);
      await client.query("COMMIT");
      return;
    }

    // 5️⃣ Distribute payouts
    let totalPaid = 0;
    for (const w of winners) {
      const winAmount = w.bet_amount * payoutRatio;
      totalPaid += winAmount;

      await client.query(
        `UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`,
        [winAmount, w.user_id]
      );

      await client.query(
        `INSERT INTO payouts (user_id, match_id, pool_type, category, amount, win_ratio)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [w.user_id, matchId, poolType, poolCategory, winAmount, payoutRatio]
      );
    }

    // 6️⃣ Mark pool as completed
    await archivePool(client, matchId, poolType, poolCategory, resultOptionId);
    await client.query(
      `UPDATE pools
       SET is_completed = true, result_option_id = $1, payout_ratio = $2, payout_done = true
       WHERE match_id = $3 AND pool_type = $4 AND category = $5`,
      [resultOptionId, payoutRatio, matchId, poolType, poolCategory]
    );

    await client.query("COMMIT");

    logger.info(
      `✅ [PayoutsHandler] ${winners.length} winners credited | totalPaid=${totalPaid.toFixed(
        2
      )} tokens`
    );

    // 7️⃣ (Optional) Publish payout hash to TRON for fairness
    const payoutHash = generatePoolHash(matchId, poolType, poolCategory, resultOptionId);
    await publishHashToTron(payoutHash);

  } catch (err) {
    await client.query("ROLLBACK");
    logger.error(`💥 [PayoutsHandler] Error: ${err.message}`);
  } finally {
    client.release();
    logger.info(`🕒 [PayoutsHandler] Finished ${label} pool at ${startTime}`);
  }
}

// ============================================================
// 🧾 Archive completed pool
// ============================================================
async function archivePool(client, matchId, poolType, category, resultOptionId) {
  await client.query(
    `INSERT INTO completed_pools (match_id, pool_type, category, result_option_id, completed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT DO NOTHING;`,
    [matchId, poolType, category, resultOptionId]
  );
  logger.debug(`📦 [PayoutsHandler] Archived ${poolType}-${category} pool.`);
}

// ============================================================
// 🧮 Hash generator (proof of payout)
// ============================================================
function generatePoolHash(matchId, poolType, category, resultOptionId) {
  const base = `${matchId}-${poolType}-${category}-${resultOptionId}-${Date.now()}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}
