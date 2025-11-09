// ============================================================
// 🔒 LockMatchUtility — Universal Pool Locker (v3.4)
// ============================================================
//
// Purpose:
// • Locks *all* active pools for a given match (PreMatch + Live)
// • Generates hash → publishes to TRON → updates DB
// • Notifies all participants & admin via Telegram
// ============================================================

import { query } from "../db/db.js";
import { createPoolHash } from "../utils/hashUtils.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import bot from "../bot/bot.js";
import { logger } from "../utils/logger.js";

/**
 * 🔒 lockMatchUtility(match)
 * Locks ALL active or pending pools for a given match.
 * @param {object} match - DB row with match_id, team1, team2, etc.
 */
export async function lockMatchUtility(match) {
  // ✅ Clean and normalize match ID for DB queries
  const rawId = String(match.match_id || match.id || "").trim();
  const numericMatchId = parseInt(rawId.replace(/^m-/, ""), 10);

  const matchLabel = `${rawId} | ${match.team1 || "Team A"} vs ${match.team2 || "Team B"}`;
  logger.info(`🔒 [${matchLabel}] Starting universal pool lock process...`);

  try {
    // 1️⃣ Fetch all active or pending pools for this match
    const poolsRes = await query(
      `
      SELECT id, pool_type, status, total_stake
      FROM pools
      WHERE matchid = $1
        AND LOWER(status) IN ('active', 'pending');
      `,
      [numericMatchId]
    );

    const pools = poolsRes.rows || [];
    if (!pools.length) {
      logger.warn(`⚠️ [${matchLabel}] No active pools found — skipping lock.`);
      return false;
    }

    logger.info(`🔍 [${matchLabel}] Found ${pools.length} open pools → locking all.`);

    const network = (process.env.NETWORK || "").toLowerCase();
    let lastTxId = null;

    // 2️⃣ Process each active/pending pool
    for (const pool of pools) {
      const poolLabel = `${pool.pool_type.toUpperCase()} Pool`;

      try {
        // Generate deterministic hash
        const poolHash = createPoolHash(pool);
        logger.info(`   🔐 [${matchLabel}] ${poolLabel} hash: ${poolHash}`);

        // Publish to TRON (if network enabled)
        let txid = "LOCAL_TEST_TXID";
        if (["shasta", "mainnet"].includes(network)) {
          try {
            txid = await publishHashToTron(poolHash);
            logger.info(`   🔗 [${matchLabel}] ${poolLabel} published to TRON → TxID: ${txid}`);
          } catch (err) {
            logger.warn(`⚠️ [${matchLabel}] ${poolLabel} TRON publish failed: ${err.message}`);
          }
        } else {
          logger.debug(`🧪 [${matchLabel}] Mock mode — skipping TRON publish.`);
        }
        lastTxId = txid;

        // Lock the pool
        await query(
          `
          UPDATE pools
          SET 
            status = 'locked',
            lock_hash = $1,
            tron_txid = $2,
            locked_at = NOW(),
            updated_at = NOW()
          WHERE id = $3;
          `,
          [poolHash, txid, pool.id]
        );
        logger.info(`✅ [${matchLabel}] ${poolLabel} locked successfully.`);
      } catch (poolErr) {
        logger.error(`❌ [${matchLabel}] Failed to lock ${pool.pool_type}: ${poolErr.message}`);
      }
    }

    // 3️⃣ Notify participants (if any)
    const participantsRes = await query(
      `SELECT DISTINCT telegram_id FROM bets WHERE match_id = $1;`,
      [numericMatchId]
    );
    const participants = participantsRes.rows || [];

    if (bot && participants.length) {
      const msg =
        `🔒 *All Pools Locked*\n🏏 ${match.team1} vs ${match.team2}\n\n` +
        `All betting for this match is now closed.\n` +
        `_Tx Hash:_ \`${lastTxId}\``;

      for (const p of participants) {
        try {
          await bot.telegram.sendMessage(p.telegram_id, msg, { parse_mode: "Markdown" });
          await new Promise((r) => setTimeout(r, 100)); // rate limit safety
        } catch (err) {
          logger.warn(`⚠️ [${matchLabel}] Failed to notify ${p.telegram_id}: ${err.message}`);
        }
      }
      logger.info(`📢 [${matchLabel}] Notified ${participants.length} users about lock.`);
    } else {
      logger.info(`ℹ️ [${matchLabel}] No participants or bot not initialized.`);
    }

    // 4️⃣ Notify admin (if configured)
    if (process.env.ADMIN_CHAT_ID && bot) {
      try {
        await bot.telegram.sendMessage(
          process.env.ADMIN_CHAT_ID,
          `✅ All pools locked for ${match.team1} vs ${match.team2}\nTxID: \`${lastTxId}\``,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        logger.warn(`⚠️ [${matchLabel}] Failed to notify admin: ${err.message}`);
      }
    }

    logger.info(`🎯 [${matchLabel}] Lock process completed successfully.`);
    return true;
  } catch (err) {
    logger.error(`🚨 [${matchLabel}] Universal pool lock failed: ${err.stack || err.message}`);
    return false;
  }
}
