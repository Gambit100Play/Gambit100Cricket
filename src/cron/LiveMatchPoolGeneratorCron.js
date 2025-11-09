// ============================================================
// 🏏 LiveMatchPoolGeneratorCron — Per-Match Smart Mode (v4.2 Stable)
// ============================================================
//
// • Starts per-match when match becomes locked_pre
// • Runs every 2 min until match completes
// • Fetches live state via fetchLiveScore()
// • Locks previous pools, creates new ones per 5 overs
// ============================================================

import cron from "node-cron";
import crypto from "crypto";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import { query } from "../db/db.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { fetchLiveScore } from "../api/fetchLiveScore.js";
import { logger } from "../utils/logger.js";

dotenv.config();

const activeJobs = new Map();
logger.info("🏏 [Cron] LiveMatchPoolGeneratorCron v4.2 initialized.");

// ============================================================
// 🔐 Hash Generator
// ============================================================
function makeHash(pool) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        matchid: pool.matchid,
        category: pool.category,
        start_over: pool.start_over,
        end_over: pool.end_over,
        threshold: pool.threshold,
        options: pool.options,
      })
    )
    .digest("hex");
}

// ============================================================
// 📈 Threshold Estimator (adaptive)
// ============================================================
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

// ============================================================
// 🔒 Lock previous 5-over window pools (Fixed)
// ============================================================
async function lockPreviousPools(matchId, prevEndOver) {
  try {
    const { rows } = await query(
      `SELECT * FROM live_pools WHERE matchid=$1 AND end_over=$2 AND status='active'`,
      [matchId, prevEndOver]
    );

    if (!rows.length) return;

    const network = (process.env.NETWORK || "").toLowerCase();

    for (const pool of rows) {
      const hash = makeHash(pool);
      let txid = "LOCAL_TEST_TXID";

      if (["shasta", "mainnet"].includes(network)) {
        try {
          txid = await publishHashToTron(hash);
          logger.info(`🔗 [TRON] Published hash for pool ${pool.id} → txid=${txid}`);
        } catch (err) {
          logger.warn(`⚠️ [TRON] Publish failed for pool ${pool.id}: ${err.message}`);
        }
      }

      // ✅ Corrected parameterized UPDATE (no bind mismatch)
      await query(
        `UPDATE live_pools
           SET status='locked',
               locked_at=NOW(),
               pool_hash=$1,
               tron_txid=$2,
               updated_at=NOW()
         WHERE id=$3;`,
        [hash || null, txid || null, pool.id]
      );

      logger.info(
        `🔒 [AutoLock] Locked pool_id=${pool.id} (${pool.category} ${pool.start_over}-${pool.end_over}) for match ${matchId}`
      );
    }
  } catch (err) {
    logger.error(`❌ [lockPreviousPools] match=${matchId} → ${err.message}`);
  }
}

// ============================================================
// 🧩 Generate Pools for ONE match
// ============================================================
async function generateLivePoolsForMatch(rawId) {
  const matchId = parseInt(String(rawId).replace(/^m-/, "").trim(), 10);
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  logger.info(`\n[LiveMatchPoolGeneratorCron] Tick → ${now} | match=${matchId}`);

  const { rows: matchRows } = await query(
    `SELECT team1, team2, status FROM matches WHERE match_id=$1`,
    [matchId]
  );

  if (!matchRows.length) {
    logger.warn(`[${matchId}] Match not found in DB — stopping job.`);
    stopLivePoolCron(matchId);
    return;
  }

  const { team1, team2, status } = matchRows[0];
  logger.info(`➡️ [Match] ${team1} vs ${team2} (${matchId}) | status=${status}`);

  // ✅ Fetch live score
  const stats = await fetchLiveScore(matchId);
  if (!stats) {
    logger.warn(`[${matchId}] fetchLiveScore() returned null — retry next tick.`);
    return;
  }

  const { overs = 0, state } = stats;
  const normalizedState = (state || "").toLowerCase();

  // 🏁 Stop if match completed
  if (["complete", "completed", "result", "innings break"].some((s) => normalizedState.includes(s))) {
    logger.info(`🏁 [${matchId}] Match completed — stopping pool generation.`);
    await query(`UPDATE matches SET status='completed', updated_at=NOW() WHERE match_id=$1`, [matchId]);
    stopLivePoolCron(matchId);
    return;
  }

  if (overs <= 0) {
    logger.debug(`⏳ [${matchId}] Match not yet started (overs=${overs}).`);
    return;
  }

  const currentOver = Math.floor(overs);
  const endOver = Math.ceil((currentOver + 1) / 5) * 5;
  const startOver = Math.max(0, endOver - 5);
  const prevEndOver = endOver - 5;

  logger.info(
    `📊 [Stats ${matchId}] overs=${overs}, runs=${stats.runs}, wkts=${stats.wickets}, bounds=${stats.boundaries}`
  );

  await lockPreviousPools(matchId, prevEndOver);

  // Avoid duplicate active pool
  const { rows: existing } = await query(
    `SELECT id FROM live_pools WHERE matchid=$1 AND start_over=$2 AND end_over=$3 AND status='active'`,
    [matchId, startOver, endOver]
  );

  if (existing.length) {
    logger.debug(`⏳ [${matchId}] Active pool already exists for ${startOver}-${endOver}`);
    return;
  }

  // ✅ Create new active pools
  const categories = ["score", "wickets", "boundaries"];
  for (const category of categories) {
    const threshold = estimateThreshold(category, stats, endOver);
    const options = {
      current_runs: stats.runs,
      current_wickets: stats.wickets,
      current_boundaries: stats.boundaries,
      current_over: stats.overs,
      projected_runs: Math.round((stats.runs / Math.max(stats.overs, 1)) * endOver),
      last_updated_at: new Date().toISOString(),
    };

    await query(
      `INSERT INTO live_pools
         (matchid, category, start_over, end_over, threshold, options, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW());`,
      [matchId, category, startOver, endOver, threshold, JSON.stringify(options)]
    );

    logger.info(
      `🎯 [${matchId}] [${category}] New pool → overs ${startOver}-${endOver}, threshold=${threshold}`
    );
  }

  logger.info("──────────────────────────────────────────────");
}

// ============================================================
// ⏰ Start / Stop Per-Match
// ============================================================
export function startLivePoolCron(matchId) {
  const numericId = parseInt(String(matchId).replace(/^m-/, "").trim(), 10);
  if (activeJobs.has(numericId)) {
    logger.info(`⚙️ [LivePoolCron] Already running for match ${numericId}`);
    return;
  }

  logger.info(`🟢 [LivePoolCron] Starting 2-min cron for match ${numericId}`);
  const job = cron.schedule(
    "*/2 * * * *",
    () => generateLivePoolsForMatch(numericId),
    { timezone: "Asia/Kolkata" }
  );

  activeJobs.set(numericId, job);
  job.start();
}

export function stopLivePoolCron(matchId) {
  const numericId = parseInt(String(matchId).replace(/^m-/, "").trim(), 10);
  const job = activeJobs.get(numericId);
  if (job) {
    job.stop();
    activeJobs.delete(numericId);
    logger.info(`🔴 [LivePoolCron] Stopped for match ${numericId}`);
  }
}
