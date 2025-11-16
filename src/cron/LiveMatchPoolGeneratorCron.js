// ============================================================
// 🏏 LiveMatchPoolGeneratorCron v8 — Overs-Only Smart Mode (FINAL)
// ============================================================
//
// NEW FEATURES IN v8:
// • Detects innings switch using miniscore.inningsid (100% reliable)
// • Immediately locks ALL pools from previous innings
// • Still creates the FINAL chunk of an innings even if innings ends early
// • NO dependence on state="innings break" (Cricbuzz rarely sends this)
// • Only uses:
//       - overseplist
//       - miniscore
//       - matchheaders.state
//       - inningsid
// ============================================================

import cron from "node-cron";
import crypto from "crypto";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import { query } from "../db/db.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { fetchLiveOvers } from "../api/fetchLiveOvers.js";
import { logger } from "../utils/logger.js";

dotenv.config();

const activeJobs = new Map();
const lastInnings = new Map();   // ⭐ NEW: Track innings switching


// ============================================================
// 🔐 Hash Generator
// ============================================================
function makeHash(pool) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      matchid: pool.matchid,
      category: pool.category,
      start_over: pool.start_over,
      end_over: pool.end_over,
      threshold: pool.threshold,
      options: pool.options,
    }))
    .digest("hex");
}


// ============================================================
// 🧮 Extract last-5 completed overs for CURRENT innings
// ============================================================
function extractFiveOverStats(oversData) {
  const overs = oversData?.overseplist?.oversep || [];
  const inningsId = oversData?.miniscore?.inningsid || null;

  if (!inningsId) {
    return { runs: 0, wickets: 0, boundaries: 0, overs: 0, raw: [], inningsid: null };
  }

  const filtered = overs.filter(o => Number(o.inningsid) === Number(inningsId));
  const completed = filtered.filter(o => String(o.overnum).endsWith(".6"));
  const lastFive = completed.slice(0, 5);

  let runs = 0, boundaries = 0, wickets = 0;
  for (const ov of lastFive) {
    runs += ov.runs || 0;

    const balls = String(ov.oversummary || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (const b of balls) {
      const ball = b.toUpperCase();
      if (ball === "4" || ball === "6") boundaries++;
      if (ball === "W") wickets++;
    }
  }

  return {
    runs,
    wickets,
    boundaries,
    overs: lastFive.length,
    raw: lastFive,
    inningsid: inningsId
  };
}


// ============================================================
// 📈 Threshold Estimator
// ============================================================
function estimateThreshold(category, stats) {
  const { runs = 0, overs = 1, wickets = 0, boundaries = 0 } = stats;
  const RR = runs / Math.max(overs, 1);
  const projected = Math.round(RR * 5);

  switch (category) {
    case "score": return projected;
    case "wickets": return Math.min(10, wickets + 1);
    case "boundaries": return Math.max(0, boundaries + 1);
    default: return 0;
  }
}


// ============================================================
// 🔒 Lock previous 5-over pools
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
        } catch (e) {
          logger.warn(`⚠️ TRON publish failed for pool=${pool.id}: ${e.message}`);
        }
      }

      await query(
        `UPDATE live_pools SET status='locked', locked_at=NOW(),
         pool_hash=$1, tron_txid=$2, updated_at=NOW()
         WHERE id=$3`,
        [hash, txid, pool.id]
      );

      logger.info(`🔒 Locked chunk ${pool.start_over}-${pool.end_over}`);
    }

  } catch (err) {
    logger.error(`❌ lockPreviousPools(${matchId}) → ${err.message}`);
  }
}


// ============================================================
// 🧩 Main Cron Logic
// ============================================================
async function generateLivePoolsForMatch(rawId) {
  const matchId = parseInt(String(rawId).replace(/^m-/, ""), 10);

  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  logger.info(`\n[PoolCron] Tick → ${now} | match=${matchId}`);
  logger.info("──────────────────────────────────────────────");

  const oversData = await fetchLiveOvers(matchId);

  const matchStateRaw = oversData?.matchheaders?.state || "";
  const matchState = matchStateRaw.toLowerCase();

  const format = (oversData?.matchheaders?.matchformat || "").toLowerCase();
  const isTest = format.includes("test") || format.includes("ranji");

  const stats = extractFiveOverStats(oversData);

  // ============================================================
  // ⭐ NEW: Innings Switch Detection
  // ============================================================
  const prevInnings = lastInnings.get(matchId);
  const currInnings = stats.inningsid;

  if (!prevInnings && currInnings) {
    lastInnings.set(matchId, currInnings);
  }

  if (prevInnings && currInnings && prevInnings !== currInnings) {
    logger.info(
      `[${matchId}] 🔄 INNINGS SWITCH DETECTED: ${prevInnings} → ${currInnings}`
    );

    // Lock *all* previous innings pools
    await query(`
      UPDATE live_pools 
      SET status='locked', locked_at=NOW(), updated_at=NOW()
      WHERE matchid=$1 AND status='active';
    `, [matchId]);

    lastInnings.set(matchId, currInnings);
    return; // Do NOT create next chunk until some completed overs appear
  }


  // ============================================================
  // ✋ Match Complete
  // ============================================================
  if (matchState.includes("complete") || matchState.includes("match ended")) {
    logger.info(`[${matchId}] Match Complete → Final Lock.`);
    await lockPreviousPools(matchId, 999); // Lock any remaining
    stopLivePoolCron(matchId);
    return;
  }


  // ============================================================
  // 🧮 If no completed overs → wait
  // ============================================================
  if (stats.overs === 0) {
    logger.warn(`[${matchId}] No completed overs yet`);
    return;
  }

  // ============================================================
  // 🎯 Compute chunk boundaries
  // ============================================================
  const completedOver = stats.raw[0].overnum;  // e.g., 50.0
  const c = Math.floor(completedOver);
  const endOver = Math.ceil((c + 1) / 5) * 5;
  const startOver = endOver - 5;
  const prevEndOver = startOver;

  logger.info(
    `📊 Innings ${stats.inningsid} → runs=${stats.runs}, wkts=${stats.wickets}, bounds=${stats.boundaries}`
  );

  // ============================================================
  // 🔒 Lock previous chunk
  // ============================================================
  await lockPreviousPools(matchId, prevEndOver);


  // ============================================================
  // ❌ Avoid creating duplicate chunk
  // ============================================================
  const { rows: exists } = await query(
    `SELECT id FROM live_pools WHERE matchid=$1 
     AND start_over=$2 AND end_over=$3 AND status='active'`,
    [matchId, startOver, endOver]
  );

  if (exists.length) {
    logger.info(`⏳ Chunk ${startOver}-${endOver} already exists`);
    return;
  }

  // ============================================================
  // 🎯 Create NEW chunk pools
  // ============================================================
  for (const category of ["score", "wickets", "boundaries"]) {
    const threshold = estimateThreshold(category, stats);

    await query(
      `INSERT INTO live_pools
       (matchid, category, start_over, end_over, threshold, options, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW())`,
      [
        matchId,
        category,
        startOver,
        endOver,
        threshold,
        JSON.stringify({
          innings_id: stats.inningsid,
          last_five_over_stats: stats,
          match_state: matchStateRaw,
          last_updated_at: new Date().toISOString(),
        })
      ]
    );

    logger.info(`🎯 Created pool → [${category}] ${startOver}-${endOver} | TH=${threshold}`);
  }
}


// ============================================================
// ⏰ Start / Stop Cron
// ============================================================
export function startLivePoolCron(matchId) {
  const id = parseInt(String(matchId).replace(/^m-/, ""), 10);

  if (activeJobs.has(id)) {
    logger.info(`⚙️ Cron already running for match ${id}`);
    return;
  }

  logger.info(`🟢 Starting cron for match ${id}`);

  const job = cron.schedule(
    "*/2 * * * *",
    () => generateLivePoolsForMatch(id),
    { timezone: "Asia/Kolkata" }
  );

  activeJobs.set(id, job);
  job.start();
}

export function stopLivePoolCron(matchId) {
  const id = parseInt(String(matchId).replace(/^m-/, ""), 10);

  const job = activeJobs.get(id);
  if (!job) return;

  job.stop();
  activeJobs.delete(id);

  logger.info(`🔴 Cron stopped for match ${id}`);
}
