// src/pool/poolLocker.js
import { query } from "../db/db.js";
import { getPoolInfo } from "../db/poolLogic.js";
import { canonicalStringify, sha256Hex } from "../utils/canonical.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { DateTime } from "luxon";

/**
 * 🧩 Build deterministic snapshot of PreMatch pool
 * Returns { snapshot, canon, hashHex }
 */
export async function buildPreMatchSnapshot(client, matchId) {
  // 1️⃣ Distinct participants
  const { rows: distinctRows } = await client.query(
    `SELECT DISTINCT telegram_id
       FROM bets
      WHERE match_id = $1 AND LOWER(market_type)=LOWER('PreMatch')`,
    [matchId]
  );
  const participants = distinctRows.map(r => String(r.telegram_id)).sort();

  // 2️⃣ All bets for this pool
  const { rows: bets } = await client.query(
    `SELECT id, telegram_id, bet_option, stake, status, created_at
       FROM bets
      WHERE match_id = $1 AND LOWER(market_type)=LOWER('PreMatch')
      ORDER BY created_at, id`,
    [matchId]
  );

  // 3️⃣ Per-option total stakes
  const { rows: perOpt } = await client.query(
    `SELECT bet_option, COALESCE(SUM(stake),0) AS total_stake
       FROM bets
      WHERE match_id = $1 AND LOWER(market_type)=LOWER('PreMatch')
      GROUP BY bet_option
      ORDER BY bet_option`,
    [matchId]
  );
  const perOptionStake = {};
  for (const r of perOpt) perOptionStake[r.bet_option] = Number(r.total_stake || 0);

  // 4️⃣ Match meta
  const { rows: mrows } = await client.query(
    `SELECT id, name, status, start_time, start_date, start_time_local
       FROM matches WHERE id = $1 LIMIT 1`,
    [matchId]
  );
  const match = mrows[0] || {};
  const lockedAt = DateTime.utc().toISO();

  // 5️⃣ Pool summary for consistency
  const poolInfo = await getPoolInfo(matchId, "PreMatch");

  // 6️⃣ Assemble canonical snapshot
  const snapshot = {
    meta: {
      match_id: String(matchId),
      match_name: match.name || null,
      market_type: "PreMatch",
      locked_at_iso: lockedAt,
      match_status: match.status || null,
      start_time_utc: match.start_time || null,
      ist_date: match.start_date || null,
      ist_time: match.start_time_local || null,
      source: "preMatch-locker@1",
    },
    participants, // distinct telegram_ids
    bets: bets.map(b => ({
      id: b.id,
      telegram_id: String(b.telegram_id),
      option: b.bet_option,
      stake: Number(b.stake),
      status: b.status,
      created_at: b.created_at,
    })),
    totals: {
      total_players: participants.length,
      total_stake: bets.reduce((a, b) => a + Number(b.stake || 0), 0),
      per_option_stake: perOptionStake,
      bets_count: bets.length,
    },
    odds_basis: {
      margin: 0.10,
      active_at_lock: poolInfo.status === "active",
    },
    data_checks: {
      unique_calc: poolInfo.participants,
      progress_pct: poolInfo.progress,
    },
  };

  const canon = canonicalStringify(snapshot);
  const hashHex = sha256Hex(canon);

  return { snapshot, canon, hashHex };
}

/**
 * 💾 Persist locked pool info to DB
 */
export async function persistLock(client, matchId, snapshot, hashHex, tronTxId) {
  await client.query(
    `INSERT INTO pool_locks (match_id, market_type, snapshot_hash, tron_tx_id, snapshot_json)
     VALUES ($1, 'PreMatch', $2, $3, $4)
     ON CONFLICT (match_id, market_type)
     DO NOTHING`,
    [matchId, hashHex, tronTxId, JSON.stringify(snapshot)]
  );

  await client.query(
    `UPDATE matches
        SET prematch_locked = TRUE,
            prematch_locked_at = NOW()
      WHERE id = $1`,
    [matchId]
  );
}

/**
 * 🔐 Main entry: Lock pool + hash snapshot + publish on Tron
 * Returns { status, hashHex, tronTxId }
 */
export async function lockPreMatchPool(matchId) {
  const client = await query("BEGIN").then(() => query.client).catch(() => null);

  // if you’re using pool directly, do this instead:
  const { Pool } = await import("pg");
  const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT,
  });
  const c = await pool.connect();

  try {
    await c.query("BEGIN");

    // Build snapshot
    const { snapshot, hashHex } = await buildPreMatchSnapshot(c, matchId);

    // Publish hash to Tron blockchain
    const tronTxId = await publishHashToTron(hashHex);

    // Save results
    await persistLock(c, matchId, snapshot, hashHex, tronTxId);

    await c.query("COMMIT");
    console.log(`✅ Pool locked for match ${matchId}: hash=${hashHex}, tx=${tronTxId}`);
    return { status: "locked", hashHex, tronTxId };
  } catch (err) {
    await c.query("ROLLBACK");
    console.error(`❌ [PoolLocker] Failed to lock pool for ${matchId}:`, err.message);
    return { status: "error", message: err.message };
  } finally {
    c.release();
  }
}
