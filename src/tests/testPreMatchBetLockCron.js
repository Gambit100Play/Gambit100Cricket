/**
 * ============================================================
 * 🧪 testPreMatchBetLockCron.js
 * ------------------------------------------------------------
 * ✅ Simulates a single cron tick for PreMatchBetLockCron
 * ✅ Verifies toss/first-ball detection logic
 * ✅ Logs each step (hashing, TRON publishing, DB locking)
 * ============================================================
 */

import dotenv from "dotenv";
import { DateTime } from "luxon";
import { getPendingPrematchMatches, lockMatchPool, query } from "../db/db.js";
import { getPoolInfo } from "../db/poolLogic.js";
import { getMatchStatusSummary } from "../api/matchStatus.js";
import { createPoolHash } from "../utils/hashUtils.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { logger } from "../utils/logger.js";

dotenv.config();

logger.info("🧪 [Test] PreMatchBetLockCron (Toss + First Ball) Test Initialized.");

/**
 * Simulates a single tick of the cron job.
 * Usage:
 *   node src/tests/testPreMatchBetLockCron.js
 */
async function runTestTick() {
  const now = DateTime.now()
    .setZone("Asia/Kolkata")
    .toFormat("dd LLL yyyy, hh:mm a");

  logger.info(`🕒 [Test] Running at ${now}`);

  try {
    const pending = await getPendingPrematchMatches();
    if (!pending?.length) {
      logger.warn("⚠️ No pending pre-match pools found in DB. Add sample data to test.");
      return;
    }

    logger.info(`📋 Found ${pending.length} pending matches to inspect.\n`);

    for (const match of pending) {
      logger.info(`➡️ Checking match ${match.match_id}: ${match.team1} vs ${match.team2}`);

      try {
        // 1️⃣ Get match status from API
        const summary = await getMatchStatusSummary(match.match_id);
        const state = summary?.state || "unknown";
        const toss = summary?.toss || "";
        const overs = Number(summary?.overs || 0);
        const innings = Number(summary?.innings || 0);

        logger.info(
          `   📡 API → state="${state}" | toss="${toss || "—"}" | overs=${overs} | innings=${innings}`
        );

        const lowerState = state.toLowerCase();
        const lowerToss = toss.toLowerCase();
        const firstBallBowled = overs > 0 || innings > 0;

        // 🧠 Determine if match has started or toss done
        const shouldLock =
          lowerState.includes("toss") ||
          lowerState.includes("in progress") ||
          lowerState.includes("1st innings") ||
          lowerState.includes("first innings") ||
          lowerToss.includes("opt to") ||
          lowerToss.includes("elected to") ||
          firstBallBowled;

        if (!shouldLock) {
          logger.info("   ⏳ Still before toss/first ball — skipping for now.\n");
          continue;
        }

        logger.info("   ⚠️ Toss or first ball detected — proceeding to lock pool...");

        // 2️⃣ Fetch pool snapshot
        const poolInfo = await getPoolInfo(match.match_id, "PreMatch");
        const rows = poolInfo?.rows || [];

        if (!rows.length) {
          logger.warn(`   ⚠️ No valid pool data found for match ${match.match_id}.`);
          continue;
        }

        logger.info(
          `   🧾 Pool snapshot: ${rows.length} options | total stake=${poolInfo.totalStake}`
        );

        // 3️⃣ Generate hash from current pool state
        const hash = createPoolHash(rows);
        logger.info(`   🔐 Pool hash generated: ${hash}`);

        // 4️⃣ Publish to TRON (mock for local)
        let txid = "TEST_TX_ID";
        if (
          process.env.NETWORK?.toLowerCase() === "shasta" ||
          process.env.NETWORK?.toLowerCase() === "mainnet"
        ) {
          try {
            txid = await publishHashToTron(hash);
            logger.info(`   🔗 TRON TxID: ${txid}`);
          } catch (tronErr) {
            logger.error(`   ⚠️ TRON publish failed: ${tronErr.message}`);
          }
        } else {
          logger.info(`   🧪 [Mock TRON] Skipped publish (hash=${hash.slice(0, 8)}...).`);
        }

        // 5️⃣ Update DB to mark as locked
        await lockMatchPool(match.match_id, hash, txid);
        logger.info(`   ✅ Pool locked successfully in DB for match ${match.match_id}`);

        // 6️⃣ Optional: check participants for reference
        const partRes = await query(
          `SELECT COUNT(DISTINCT telegram_id) AS players 
           FROM bets 
           WHERE match_id=$1 AND LOWER(market_type)='prematch'`,
          [String(match.match_id)]
        );

        const players = Number(partRes.rows[0]?.players || 0);
        logger.info(`   👥 Participants recorded: ${players}.\n`);
      } catch (innerErr) {
        logger.error(`❌ Error while processing ${match.match_id}: ${innerErr.message}`);
      }
    }
  } catch (err) {
    logger.error(`🚨 [Test] Fatal: ${err.message}`);
  }

  logger.info("✅ [Test] PreMatchBetLockCron test complete.\n──────────────────────────────");
}

runTestTick();
