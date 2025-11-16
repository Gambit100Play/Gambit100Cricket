// ============================================================
// 💰 PayoutHandler — Unified Payout Logic (v3.1 Final)
// ============================================================
//
// • Handles both Pre-Match and Live pool payouts
// • Updates internal balances (balances.tokens)
// • Logs all payouts + optional TRON proof
// ============================================================

import { query } from "../../db/db.js";
import { logger } from "../../utils/logger.js";
import { publishHashToTron } from "../../utils/tronPublisher.js";

// ============================================================
// 🧮 Utility: Winner Determination per Pool Category
// ============================================================
function determineWinningOption(pool, match, latestStats = null) {
  try {
    const category = pool.category?.toLowerCase();
    const opts = pool.options ? JSON.parse(pool.options) : {};
    const threshold = Number(pool.threshold || 0);

    // For pre-match pools, winner is just the match result
    if (pool.pool_type === "PreMatch") {
      return (match.winner_team || "").toLowerCase();
    }

    // For live pools, decide by category vs threshold
    const currentRuns = latestStats?.runs ?? opts.current_runs ?? 0;
    const currentWickets = latestStats?.wickets ?? opts.current_wickets ?? 0;
    const currentBoundaries = latestStats?.boundaries ?? opts.current_boundaries ?? 0;

    if (category === "score") {
      return currentRuns >= threshold ? "over" : "under";
    } else if (category === "wickets") {
      return currentWickets >= threshold ? "many" : "few";
    } else if (category === "boundaries") {
      return currentBoundaries >= threshold ? "over" : "under";
    }

    return null;
  } catch (err) {
    logger.error(`❌ [determineWinningOption] pool=${pool.id} → ${err.message}`);
    return null;
  }
}

// ============================================================
// ⚙️ Core Handler
// ============================================================
export async function handlePayoutsForMatch(matchId, mode = "final", latestStats = null) {
  logger.info(`💰 [PayoutHandler] Starting for match=${matchId}, mode=${mode}`);

  try {
    // 1️⃣ Fetch all locked pools eligible for payout
    const poolCondition =
      mode === "final"
        ? "pool_type IN ('PreMatch','Live')"
        : "pool_type='Live'";

    const { rows: lockedPools } = await query(
      `SELECT * FROM pools
         WHERE matchid=$1 AND status='locked' AND ${poolCondition}`,
      [matchId]
    );

    if (!lockedPools.length) {
      logger.info(`ℹ️ [PayoutHandler] No locked pools found for match=${matchId}.`);
      return;
    }

    // 2️⃣ Fetch match info
    const { rows: matchRows } = await query(
      `SELECT * FROM matches WHERE match_id=$1`,
      [matchId]
    );
    const match = matchRows[0] || {};

    // 3️⃣ Process each pool
    for (const pool of lockedPools) {
      logger.info(`🧩 [Pool] Processing pool_id=${pool.id} (${pool.category})`);

      const winnerOption = determineWinningOption(pool, match, latestStats);
      if (!winnerOption) {
        logger.warn(`⚠️ [Payout] Could not determine winner for pool ${pool.id}`);
        continue;
      }

      // Fetch user bets
      const { rows: userBets } = await query(
        `SELECT telegram_id, match_id AS pool_id, bet_option AS option, stake
           FROM bets WHERE match_id=$1`,
        [pool.matchid]
      );

      if (!userBets.length) {
        logger.debug(`🪶 [Payout] No user bets found for pool ${pool.id}`);
        await query(
          `UPDATE pools SET status='paid', updated_at=NOW() WHERE id=$1`,
          [pool.id]
        );
        continue;
      }

      const totalPool = Number(pool.total_stake || 0);
      const winners = userBets.filter(
        (b) => (b.option || "").toLowerCase() === winnerOption
      );
      const totalWinningStake = winners.reduce(
        (sum, b) => sum + Number(b.stake),
        0
      );

      if (totalWinningStake <= 0) {
        logger.warn(`⚠️ [Payout] No valid winning stakes for pool ${pool.id}`);
        await query(
          `UPDATE pools SET status='paid', updated_at=NOW() WHERE id=$1`,
          [pool.id]
        );
        continue;
      }

      // 4️⃣ Distribute payouts to winners
      for (const bet of winners) {
        const payout = (bet.stake / totalWinningStake) * totalPool;
        const profit = payout - bet.stake;

        // 🪙 Credit off-chain balance in balances table
        await query(
          `UPDATE balances
             SET tokens = tokens + $1
           WHERE telegram_id = $2;`,
          [payout, bet.telegram_id]
        );

        // 🧾 Log payout
        const { rows: payoutRow } = await query(
          `INSERT INTO payouts (telegram_id, pool_id, payout_amount, profit, created_at)
           VALUES ($1,$2,$3,$4,NOW())
           RETURNING id;`,
          [bet.telegram_id, pool.id, payout, profit]
        );

        // 🔗 Optional TRON proof (for transparency)
        let tronTx = "LOCAL_TEST_TX";
        const network = (process.env.NETWORK || "").toLowerCase();

        if (["shasta", "mainnet"].includes(network)) {
          try {
            const hashPayload = JSON.stringify({
              pool_id: pool.id,
              telegram_id: bet.telegram_id,
              payout,
            });
            tronTx = await publishHashToTron(hashPayload);
          } catch (err) {
            logger.warn(
              `⚠️ [TRON] Publish failed for user=${bet.telegram_id}: ${err.message}`
            );
          }
        }

        await query(
          `UPDATE payouts SET tron_txid=$1 WHERE id=$2;`,
          [tronTx, payoutRow[0].id]
        );

        logger.info(
          `✅ [Payout] user=${bet.telegram_id} | pool=${pool.id} | +${payout.toFixed(
            2
          )} Tokens | tx=${tronTx}`
        );
      }

      // 5️⃣ Mark pool as paid
      await query(
        `UPDATE pools
           SET status='paid', updated_at=NOW()
         WHERE id=$1;`,
        [pool.id]
      );

      logger.info(`🏁 [Pool] Completed payout for pool_id=${pool.id}`);
    }

    logger.info(`🎉 [PayoutHandler] All payouts done for match=${matchId}`);
  } catch (err) {
    logger.error(`❌ [PayoutHandler] match=${matchId} → ${err.message}`);
  }
}
