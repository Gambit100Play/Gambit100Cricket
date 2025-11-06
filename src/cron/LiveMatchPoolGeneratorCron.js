// src/cron/LiveMatchPoolGeneratorCron.js
import cron from "node-cron";
import crypto from "crypto";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import { query } from "../db/db.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { fetchLiveScore } from "../api/fetchLiveScore.js";
import { logger } from "../utils/logger.js";

dotenv.config();

logger.info("🏏 [Cron] LiveMatchPoolGeneratorCron initialized (Auto-Lock Mode + LiveScore Integration).");

/* 🔐 Hash Generator */
function createPoolHash(pool) {
  const payload = {
    category: pool.category,
    threshold: pool.threshold,
    start_over: pool.start_over,
    end_over: pool.end_over,
    options: pool.options,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/* 📈 Threshold Estimator */
function estimateThreshold(category, stats, endOver) {
  const { runs = 0, overs = 0, wickets = 0, boundaries = 0 } = stats;
  const runRate = overs > 0 ? runs / overs : 6.0;
  const projectedRuns = Math.round(runRate * endOver);

  switch (category) {
    case "score":
      return Math.round(projectedRuns * 1.05);
    case "wickets":
      return Math.min(10, Math.floor(wickets + endOver / 10));
    case "boundaries":
      return Math.floor(boundaries + endOver / 3);
    default:
      return 0;
  }
}

/* 🔒 Lock previous pool */
async function lockPreviousPool(matchId, prevEndOver) {
  try {
    const { rows } = await query(
      `SELECT id, category, threshold, start_over, end_over, options
       FROM live_pools
       WHERE matchid=$1 AND end_over=$2 AND status='active'`,
      [matchId, prevEndOver]
    );

    if (!rows.length) return;

    for (const pool of rows) {
      const poolHash = createPoolHash(pool);
      let txid = "LOCAL_TEST_TXID";
      const network = (process.env.NETWORK || "").toLowerCase();

      if (["shasta", "mainnet"].includes(network)) {
        try {
          txid = await publishHashToTron(poolHash);
          logger.info(`🔗 [TRON] Published hash for pool=${pool.id}, txid=${txid}`);
        } catch (err) {
          logger.warn(`⚠️ [TRON] Publish failed for pool=${pool.id}: ${err.message}`);
        }
      } else {
        logger.debug(`🧪 [MockTRON] Skipping publish for pool ${pool.id}`);
      }

      await query(
        `UPDATE live_pools 
           SET status='locked', locked_at=NOW(), pool_hash=$1, tron_txid=$2
         WHERE id=$3`,
        [poolHash, txid, pool.id]
      );

      logger.info(`🔒 [AutoLock] Locked [${pool.category}] (${pool.start_over}-${pool.end_over}) for match ${matchId}`);
    }
  } catch (err) {
    logger.error(`❌ [lockPreviousPool] match=${matchId}: ${err.message}`);
  }
}

/* 🧩 Cron Job — Every 2 min */
cron.schedule("0 6/18 * * *", async () => {
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  logger.info(`[LiveMatchPoolGeneratorCron] Tick → ${now}`);

  try {
    const liveMatches = await query(`
      SELECT match_id, team1, team2
      FROM matches
      WHERE LOWER(status) IN ('live', 'in progress')
    `);

    if (!liveMatches.rows.length) {
      logger.info("✅ No live matches currently running.");
      return;
    }

    for (const match of liveMatches.rows) {
      logger.info(`➡️ [Check] ${match.team1} vs ${match.team2} (${match.match_id})`);

      // ✅ Step 1: Fetch & update live score from API (reusing fetchLiveScore.js)
      const stats = await fetchLiveScore(match.match_id);
      if (!stats) continue;

      const currentOver = Math.floor(stats.overs || 0);
      if (currentOver <= 0) {
        logger.debug(`⏳ Match not started yet.`);
        continue;
      }

      // ✅ Step 2: Determine overs
      const endOver = Math.ceil((currentOver + 1) / 2) * 2;
      const startOver = Math.max(0, endOver - 2);
      const prevEndOver = endOver - 2;

      logger.info(
        `📊 [Stats] overs=${stats.overs}, runs=${stats.runs}, wkts=${stats.wickets}, bounds=${stats.boundaries}`
      );

      // ✅ Step 3: Lock finished pool
      await lockPreviousPool(match.match_id, prevEndOver);

      // ✅ Step 4: Skip if pool already exists
      const { rows: exists } = await query(
        `SELECT id FROM live_pools WHERE matchid=$1 AND end_over=$2`,
        [match.match_id, endOver]
      );
      if (exists.length) {
        logger.debug(`⏳ Pool for ${endOver} overs already exists.`);
        continue;
      }

      // ✅ Step 5: Create new pool
      const categories = ["score", "wickets", "boundaries"];
      for (const category of categories) {
        const threshold = estimateThreshold(category, stats, endOver);
        const options = {
          over: 0,
          under_equal: 0,
          current_runs: stats.runs,
          current_wickets: stats.wickets,
          current_boundaries: stats.boundaries,
          current_over: stats.overs,
          projected_runs: Math.round((stats.runs / (stats.overs || 1)) * endOver),
          last_updated_at: new Date().toISOString(),
        };

        await query(
          `INSERT INTO live_pools
             (matchid, category, start_over, end_over, threshold, options)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [match.match_id, category, startOver, endOver, threshold, JSON.stringify(options)]
        );

        logger.info(`🎯 [${category}] Created pool for overs ${startOver}-${endOver} → threshold=${threshold}`);
      }
    }
  } catch (err) {
    logger.error(`🚨 [LiveMatchPoolGeneratorCron] Fatal: ${err.message}`);
  }

  logger.info("──────────────────────────────────────────────");
});
