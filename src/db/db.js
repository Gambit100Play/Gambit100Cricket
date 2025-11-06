import pkg from "pg";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import { getPoolInfo, getPoolStatus } from "./poolLogic.js";

dotenv.config();
const { Pool } = pkg;

// =====================================================
// 🔑 Database Connection Pool
// =====================================================
export const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});
console.log("Connected to PostgreSQL");

// =====================================================
// 🧩 Generic Query Helper
// =====================================================
export async function query(text, params) {
  return pool.query(text, params);
}
// 👉 assumes you already export a `query` (pg Pool) somewhere
//    and your table is named `matches` with id, status, result, winner, updated_at, completed_at.

export async function getUncompletedMatches(limit = 50) {
  const sql = `
    SELECT id AS match_id, team1, team2
    FROM matches
    WHERE status NOT IN ('completed', 'no result', 'abandoned', 'cancelled', 'canceled')
       OR status IS NULL
    ORDER BY updated_at NULLS FIRST
    LIMIT $1
  `;
  const { rows } = await query(sql, [limit]);
  return rows; // [{ match_id, team1, team2 }]
}

export async function markMatchCompletedDb(matchId, { resultText = null, winner = null } = {}) {
  const sql = `
    UPDATE matches
       SET status = 'completed',
           result = COALESCE($2, result),
           winner = COALESCE($3, winner),
           completed_at = NOW(),
           updated_at = NOW()
     WHERE id = $1
  `;
  await query(sql, [matchId, resultText, winner]);
  return true;
}
export async function insertUserBet(userId, matchId, marketType, playOption, stake) {
  return placeBetWithDebit({
    telegramId: userId,
    matchId,
    matchName: matchId,
    betType: "Fixed",
    betOption: playOption,
    stake,
    marketType,
  });
}

// =====================================================
// 👤 USERS (Registration, Activity & Wallet Info)
// =====================================================
export async function createOrUpdateUser(
  telegramId,
  username,
  firstName = "",
  lastName = ""
) {
  const safeUsername = username || null;
  const safeFirst = firstName || "";
  const safeLast = lastName || "";

  await pool.query(
    `INSERT INTO users (
        telegram_id, username, first_name, last_name, joined_at, last_active,
        withdrawal_address, deposit_address
     )
     VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL, NULL)
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       last_active = NOW()`,
    [telegramId, safeUsername, safeFirst, safeLast]
  );

  await pool.query(
    `INSERT INTO balances (telegram_id, tokens, bonus_tokens, usdt)
     VALUES ($1, 0, 200, 0)
     ON CONFLICT (telegram_id) DO NOTHING`,
    [telegramId]
  );
}

export async function getUserById(telegramId) {
  const res = await pool.query(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [telegramId]
  );
  return res.rows[0] || null;
}

export async function updateUserActivity(telegramId) {
  await pool.query(
    `UPDATE users SET last_active = NOW() WHERE telegram_id = $1`,
    [telegramId]
  );
}

// =====================================================
// 💼 WALLET MANAGEMENT (Deposit + Withdrawal)
// =====================================================
export async function saveUserWallet(telegramId, { network = "TRON", deposit_address, withdrawal_address = null }) {
  await pool.query(
    `INSERT INTO user_wallets (telegram_id, network, deposit_address, last_balance_trx, last_balance_usdt, created_at)
     VALUES ($1, $2, $3, 0, 0, NOW())
     ON CONFLICT (telegram_id, network)
     DO UPDATE SET
       deposit_address = EXCLUDED.deposit_address,
       updated_at = NOW()`,
    [telegramId, network, deposit_address]
  );
  console.log(`💾 [DB] Wallet record saved for user ${telegramId} (${network})`);
}

export async function getUserWallet(telegramId, network = "TRON") {
  const res = await pool.query(
    `SELECT deposit_address, last_balance_trx, last_balance_usdt
       FROM user_wallets
      WHERE telegram_id = $1 AND network = $2`,
    [telegramId, network]
  );
  return res.rows[0] || {};
}


// =====================================================
// 💰 BALANCES
// =====================================================
export async function getUserBalance(telegramId) {
  const res = await pool.query(
    `SELECT tokens, bonus_tokens, usdt
       FROM balances
      WHERE telegram_id = $1`,
    [telegramId]
  );
  return res.rows[0] || { tokens: 0, bonus_tokens: 0, usdt: 0 };
}

export async function updateUserBalance(telegramId, tokens, bonusTokens, usdt) {
  await pool.query(
    `UPDATE balances
        SET tokens = $2, bonus_tokens = $3, usdt = $4
      WHERE telegram_id = $1`,
    [telegramId, tokens, bonusTokens, usdt]
  );
}

export async function getTotalUsers() {
  const res = await pool.query(`SELECT COUNT(*) AS total FROM users`);
  return Number(res.rows[0]?.total || 0);
}

// =====================================================
// 🏏 MATCHES
// =====================================================
// =====================================================
// 💾 BULK SAVE MULTIPLE MATCHES FROM CRICBUZZ (Optimized)
// =====================================================
// =====================================================
// 💾 BULK SAVE MULTIPLE MATCHES (Trust precomputed local times)
// =====================================================
export async function saveMatches(matches = []) {
  if (!matches || matches.length === 0) {
    console.log("⚠️ [DB] No matches provided to saveMatches().");
    return 0;
  }

  const client = await pool.connect();
  let saved = 0;

  try {
    await client.query("BEGIN");

    for (const match of matches) {
      try {
        // ✅ Step 1: Use India-local values provided by API layer directly
        let startDate = match.start_date || null;
        let startTimeLocal = match.start_time_local || null;

        // Fallback (rare case): derive if API didn’t send them
        if (!startDate && match.start_time) {
          const dt = DateTime.fromISO(match.start_time, { zone: "UTC" }).setZone("Asia/Kolkata");
          startDate = dt.toFormat("yyyy-LL-dd");
          startTimeLocal = dt.toFormat("HH:mm:ss");
        }

        // ✅ Step 2: Skip very old matches (>6h)
        if (match.start_time) {
          const matchTime = DateTime.fromISO(match.start_time, { zone: "UTC" }).setZone("Asia/Kolkata");
          const now = DateTime.now().setZone("Asia/Kolkata");
          const hoursDiff = now.diff(matchTime, "hours").hours;
          if (hoursDiff > 6 && match.status !== "live") {
            console.log(`⏭️ [Skip] Old match (>6h): ${match.name}`);
            continue;
          }
        }

        // ✅ Step 3: Save directly
        await client.query(
          `INSERT INTO matches (
              id, name, start_time, start_date, start_time_local,
              status, score, api_payload, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name,
                 start_time = EXCLUDED.start_time,
                 start_date = EXCLUDED.start_date,
                 start_time_local = EXCLUDED.start_time_local,
                 status = EXCLUDED.status,
                 score = EXCLUDED.score,
                 api_payload = EXCLUDED.api_payload,
                 updated_at = NOW()`,
          [
            match.id,
            match.name,
            match.start_time,          // already UTC ISO from cricbuzzApi.js
            startDate,                 // precomputed India date
            startTimeLocal,            // precomputed India time
            match.status,
            match.score || null,
            match.api_payload ? JSON.stringify(match.api_payload) : null,
          ]
        );

        saved++;
        console.log(`💾 [DB] Saved: ${match.name} (${match.status}) [${startDate} ${startTimeLocal} IST]`);
      } catch (innerErr) {
        console.warn(`⚠️ [DB] Skipped ${match.name}: ${innerErr.message}`);
      }
    }

    await client.query("COMMIT");
    console.log(`💾 [DB] Bulk saved ${saved}/${matches.length} matches successfully.`);
    return saved;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [DB] saveMatches() transaction failed:", err.message);
    return 0;
  } finally {
    client.release();
  }
}


export async function lockMatchPool(matchId, hash, txid) {
  try {
    // 1️⃣ Lock the pool in `pools` table
    await query(
      `
      UPDATE pools
      SET 
        status = 'locked_pre',
        lock_hash = $1,
        tron_txid = $2,
        locked_at = NOW(),
        updated_at = NOW()
      WHERE matchid = $3 
        AND LOWER(pool_type) = 'prematch'
        AND (status = 'active' OR status = 'pending')
      `,
      [hash, txid, matchId]
    );

    // 2️⃣ Reflect the same lock in `matches` table
    await query(
      `
      UPDATE matches
      SET 
        prematch_locked = TRUE,
        prematch_locked_at = NOW(),
        pool_hash = $1,
        tron_txid = $2,
        status = 'locked_pre'
      WHERE match_id = $3
      `,
      [hash, txid, matchId]
    );

    console.log(`✅ [DB] Pre-match pool locked for match ${matchId}`);
  } catch (err) {
    console.error(`❌ [DB] lockMatchPool failed for ${matchId}: ${err.message}`);
  }
}



// Fetch matches still in pre-match phase
export async function getPendingPrematchMatches() {
  const sql = `
    SELECT 
      m.match_id,
      m.team1,
      m.team2,
      m.series_name,
      m.match_desc,
      m.prematch_locked,
      m.prematch_locked_at,
      m.toss_detected_at,
      m.pool_hash,
      m.tron_txid
    FROM matches m
    JOIN pools p ON p.matchid = m.match_id
    WHERE LOWER(p.pool_type) = 'prematch'
      AND LOWER(p.status) IN ('active', 'pending')
      AND (m.status ILIKE 'upcoming' OR m.status ILIKE 'pre_match')
      AND (m.prematch_locked = FALSE OR m.prematch_locked IS NULL)
      AND (m.prematch_locked_at IS NULL)
  `;

  try {
    const res = await query(sql);
    return res.rows || [];
  } catch (err) {
    console.error(`❌ [getPendingPrematchMatches] Failed: ${err.message}`);
    return [];
  }
}




export async function saveMatch(match) {
  try {
    let startDate = null;
    let startTimeLocal = null;

    if (match.start_time) {
      // ✅ Step 1: Normalize format for Luxon
      const clean = match.start_time.replace(" ", "T");

      // ✅ Step 2: Parse with embedded regional offset
      const dtWithOffset = DateTime.fromISO(clean, { setZone: true });

      // ✅ Step 3: Convert to India Standard Time (Asia/Kolkata)
      const dtIST = dtWithOffset.setZone("Asia/Kolkata");

      // ✅ Step 4: Format date + time strings
      startDate = dtIST.toFormat("yyyy-LL-dd"); // e.g. 2025-10-28
      startTimeLocal = dtIST.toFormat("HH:mm"); // e.g. 10:30

      console.log(
        `🕓 [TimeConvert] ${match.name}: ${match.start_time} → ${startDate} ${startTimeLocal} IST`
      );
    }

    // 🧹 Step 5: Skip saving expired matches (older than 6 h)
    if (startDate && startTimeLocal) {
      const matchTime = DateTime.fromISO(match.start_time.replace(" ", "T"), { setZone: true });
      const now = DateTime.now().setZone("Asia/Kolkata");
      const hoursDiff = now.diff(matchTime.setZone("Asia/Kolkata"), "hours").hours;
      if (hoursDiff > 6) {
        console.log(`⛔ [DB] Skipping save for expired match: ${match.name}`);
        return;
      }
    }

    // 💾 Step 6: Upsert match record
    await pool.query(
      `INSERT INTO matches (
          id, name, start_time, start_date, start_time_local,
          status, score, api_payload, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             start_time = EXCLUDED.start_time,
             start_date = EXCLUDED.start_date,
             start_time_local = EXCLUDED.start_time_local,
             status = EXCLUDED.status,
             score = EXCLUDED.score,
             api_payload = EXCLUDED.api_payload,
             updated_at = NOW()`,
      [
        match.id,
        match.name,
        match.start_time,  // original string (with offset)
        startDate,         // India date
        startTimeLocal,    // India local time
        match.status,
        match.score,
        match.api_payload,
      ]
    );

    console.log(
      `💾 [DB] Saved: ${match.name} (${match.status}) [${startDate} ${startTimeLocal} IST]`
    );
  } catch (err) {
    console.error(`❌ [DB] Save failed for ${match.name}:`, err.message);
  }
}




export async function getMatches() {
  const res = await pool.query(`
    SELECT id, name, start_time, start_date, start_time_local, status, score
    FROM matches
    ORDER BY start_date, start_time_local ASC
  `);

  return res.rows;
}



export async function getMatchById(matchId) {
  const cleanId = String(matchId).trim();
  const res = await pool.query(
    `SELECT * FROM matches WHERE TRIM(id)::text = $1 LIMIT 1`,
    [cleanId]
  );
  return res.rows[0] || null;
}

// =====================================================
// 🎲 BETS
// =====================================================
// =====================================================
// 🎲 BETS (with automatic pool management)
// =====================================================
export async function placeBetWithDebit({
  telegramId,
  matchId,
  matchName,
  betType,
  betOption,
  stake,
  marketType = "PreMatch",
  segmentDuration = 0,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Lock user balance for update
    const balRes = await client.query(
      `SELECT tokens, bonus_tokens, usdt
         FROM balances
        WHERE telegram_id = $1
        FOR UPDATE`,
      [telegramId]
    );

    if (balRes.rowCount === 0) throw new Error("Balance not found for user");

    let { tokens, bonus_tokens: bonus, usdt } = balRes.rows[0];
    tokens = Number(tokens) || 0;
    bonus = Number(bonus) || 0;

    if (stake > tokens + bonus) throw new Error("INSUFFICIENT_FUNDS");

    // 2️⃣ Deduct stake (use bonus first)
    let remaining = stake;
    const useBonus = Math.min(bonus, remaining);
    bonus -= useBonus;
    remaining -= useBonus;
    tokens -= remaining;

    await client.query(
      `UPDATE balances
          SET tokens = $2, bonus_tokens = $3
        WHERE telegram_id = $1`,
      [telegramId, tokens, bonus]
    );

    // 3️⃣ Record the bet
    const betRes = await client.query(
      `INSERT INTO bets
         (telegram_id, match_id, match_name, bet_type, bet_option, stake,
          status, created_at, market_type, segment_duration)
       VALUES ($1, $2, $3, $4, $5, $6, 'Pending', NOW(), INITCAP($7), $8)
       RETURNING *`,
      [
        telegramId,
        matchId,
        matchName,
        betType,
        betOption,
        stake,
        marketType,
        segmentDuration,
      ]
    );

    // 4️⃣ 🔧 Auto-create or update pool summary
    // 🧩 Ensure a pool record exists for this match + pool_type
await client.query(
  `INSERT INTO pools (matchid, pool_type, status, total_stake, created_at, updated_at)
   VALUES ($1, INITCAP($2), 'active', $3, NOW(), NOW())
   ON CONFLICT (matchid, pool_type)
   DO UPDATE
     SET total_stake = pools.total_stake + $3,
         updated_at = NOW()`,
  [matchId, marketType, stake]
);


    // 5️⃣ Commit transaction
    await client.query("COMMIT");

    console.log(
      `🎯 [DB] Bet placed: ${telegramId} → ${matchName} (${betOption}, ${stake} G)`
    );
    return { bet: betRes.rows[0], balance: { tokens, bonus, usdt } };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`❌ [DB] placeBetWithDebit failed:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}



// =====================================================
// ⚖️ DYNAMIC ODDS + POOL SUMMARY
// =====================================================
// =====================================================
// ⚖️ DYNAMIC POOL SUMMARY (Uses unified logic from poolLogic.js)
// =====================================================
export async function getPoolSummary(matchId, marketType = "PreMatch") {
  try {
    // ✅ Use unified pool info to stay consistent everywhere
    const pool = await getPoolInfo(matchId, marketType);

    return {
      participants: pool.participants,      // distinct telegram_id count
      totalStake: pool.totalStake,
      status: pool.status,
      remaining: pool.remaining,
      progressBar: pool.progressBar,
    };
  } catch (err) {
    console.error("❌ [DB] getPoolSummary error:", err.message);
    return {
      participants: 0,
      totalStake: 0,
      status: "pending",
      remaining: 10,
      progressBar: "░░░░░░░░░░",
    };
  }
}

// =====================================================
// ❌ CANCEL USER BET (Transactional)
// =====================================================
// =====================================================
// ❌ CANCEL USER BET (Transactional + Pool Update)
// =====================================================
export async function cancelUserBet(telegramId, playIndex) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log(`🧾 [DB] Starting cancelUserBet for user=${telegramId} | index=${playIndex}`);

    // 1️⃣ Fetch all bets for this user ordered consistently
    const { rows: bets } = await client.query(
      `SELECT id, match_id, stake, status 
         FROM bets 
        WHERE telegram_id = $1 
        ORDER BY created_at DESC`,
      [telegramId]
    );

    if (!bets.length) {
      console.warn(`⚠️ [DB] No bets found for ${telegramId}`);
      await client.query("ROLLBACK");
      return { success: false, error: "NO_BETS" };
    }

    const bet = bets[playIndex];
    if (!bet) {
      console.warn(`⚠️ [DB] No bet at index ${playIndex} for ${telegramId}`);
      await client.query("ROLLBACK");
      return { success: false, error: "INVALID_INDEX" };
    }

    if (bet.status.toLowerCase() !== "pending") {
      console.warn(`⚠️ [DB] Bet ${bet.id} is already ${bet.status}`);
      await client.query("ROLLBACK");
      return { success: false, error: "NOT_PENDING" };
    }

    console.log(`🧮 [DB] Found bet ${bet.id} with stake=${bet.stake}`);

    // 2️⃣ Fetch current balance
    const { rows: balances } = await client.query(
      `SELECT tokens, bonus_tokens, usdt 
         FROM balances 
        WHERE telegram_id = $1 
        FOR UPDATE`,
      [telegramId]
    );

    if (!balances.length) {
      console.warn(`⚠️ [DB] No balance row found for ${telegramId}`);
      await client.query("ROLLBACK");
      return { success: false, error: "NO_BALANCE" };
    }

    const balance = balances[0];
    const newTokens = Number(balance.tokens) + Number(bet.stake);

    // 3️⃣ Update balance + mark bet as cancelled
    await client.query(
      `UPDATE balances
          SET tokens = $2
        WHERE telegram_id = $1`,
      [telegramId, newTokens]
    );

    const res = await client.query(
      `UPDATE bets
          SET status = 'Cancelled',
              result_data = jsonb_build_object('reason','User cancelled manually'),
              updated_at = NOW()
        WHERE id = $1`,
      [bet.id]
    );

    if (res.rowCount === 0) {
      console.warn(`⚠️ [DB] No rows updated for bet ${bet.id}`);
      await client.query("ROLLBACK");
      return { success: false, error: "NO_UPDATE" };
    }

    // 4️⃣ Update pool total_stake to reflect cancelled bet
    await client.query(
      `
      UPDATE pools
         SET total_stake = GREATEST(total_stake - $1, 0),
             updated_at = NOW()
       WHERE matchid = $2 AND LOWER(pool_type) = 'prematch'
      `,
      [bet.stake, bet.match_id]
    );

    // 5️⃣ Commit
    await client.query("COMMIT");

    console.log(
      `✅ [DB] Cancelled bet ${bet.id} | refunded=${bet.stake} | newTokens=${newTokens}`
    );

    // 6️⃣ Trigger odds recalculation asynchronously (non-blocking)
    refreshPoolOdds(bet.match_id, "PreMatch").catch((err) =>
      console.warn(`⚠️ [OddsRefresh] Failed post-cancel: ${err.message}`)
    );

    return {
      success: true,
      playId: bet.id,
      refunded: bet.stake,
      newBalance: newTokens,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`❌ [DB] cancelUserBet failed for ${telegramId}:`, err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}
/**
 * ♻️ Recompute and refresh pool odds after bet cancellation
 */
async function refreshPoolOdds(matchId, marketType = "PreMatch") {
  try {
    const res = await pool.query(
      `
      UPDATE pools p
         SET total_stake = sub.total_stake,
             updated_at = NOW()
        FROM (
          SELECT match_id, SUM(stake) AS total_stake
            FROM bets
           WHERE status NOT IN ('Cancelled', 'cancelled')
             AND match_id = $1
             AND LOWER(market_type) = LOWER($2)
           GROUP BY match_id
        ) sub
       WHERE p.matchid = sub.match_id
         AND LOWER(p.pool_type) = LOWER($2)
      `,
      [matchId, marketType]
    );

    if (res.rowCount > 0) {
      console.log(`♻️ [DB] Pool odds recalculated for ${matchId} (${marketType})`);
    } else {
      console.log(`ℹ️ [DB] No pool updated for ${matchId} (${marketType})`);
    }
  } catch (err) {
    console.error(`❌ [DB] refreshPoolOdds failed for ${matchId}:`, err.message);
  }
}


// =====================================================
// ⚖️ DYNAMIC ODDS + POOL SUMMARY (Updated for Real Team Names)
// =====================================================
export async function getDynamicOdds(matchId, marketType = "PreMatch") {
  try {
    // 🔍 Step 1: Fetch pool info
    const poolInfo = await getPoolInfo(matchId, marketType);
    const status = poolInfo.status || getPoolStatus(poolInfo.participants);

    // 🎯 Step 2: Fetch team names
    const matchRes = await pool.query(
      `SELECT api_payload FROM matches WHERE id = $1 LIMIT 1`,
      [matchId]
    );

    let teamA = "Team A";
    let teamB = "Team B";

    if (matchRes.rowCount > 0) {
      try {
        const payload =
          typeof matchRes.rows[0].api_payload === "object"
            ? matchRes.rows[0].api_payload
            : JSON.parse(matchRes.rows[0].api_payload || "{}");

        teamA = payload?.team1?.teamName || teamA;
        teamB = payload?.team2?.teamName || teamB;
      } catch (err) {
        console.warn("⚠️ [DB] getDynamicOdds: Could not parse api_payload:", err.message);
      }
    }

    // 💤 Pending pool: static odds
    if (status === "pending") {
      return [
        { bet_option: `${teamA} to Win`, odds: 1.00, stake_on_option: 0 },
        { bet_option: `${teamB} to Win`, odds: 1.00, stake_on_option: 0 },
        { bet_option: "Draw / Tie", odds: 1.00, stake_on_option: 0 },
        { bet_option: "Over 300 Runs", odds: 1.00, stake_on_option: 0 },
        { bet_option: "Under 300 Runs", odds: 1.00, stake_on_option: 0 },
      ];
    }

    // ✅ Step 3: Active pool odds based on stake distribution
    const totalStake = poolInfo.totalStake || 1;

    let computed = poolInfo.rows.map((r) => {
      const stake = Number(r.total_stake || 0);
      const share = stake / totalStake;

      // 🧮 Dynamic odds formula
      const fairOdds = 1 / Math.max(share, 0.05);
      const adjusted = fairOdds * 0.9;
      const dynamic = Math.min(Math.max(adjusted, 1.1), 10.0);

      // Normalize option names
      let normalizedOption = r.bet_option
        .replace(/Team A/gi, teamA)
        .replace(/Team B/gi, teamB)
        .trim();

      return {
        bet_option: normalizedOption,
        odds: Number(dynamic.toFixed(2)),
        stake_on_option: stake,
      };
    });

    // ✅ Step 4: Remove duplicates — keep the one with higher stake
    const unique = new Map();
    for (const opt of computed) {
      const key = opt.bet_option.toLowerCase();
      if (!unique.has(key) || opt.stake_on_option > unique.get(key).stake_on_option) {
        unique.set(key, opt);
      }
    }
    computed = [...unique.values()];

    // ✅ Step 5: Fill missing defaults (if none exist)
    const defaults = [
      `${teamA} to Win`,
      `${teamB} to Win`,
      "Draw / Tie",
      "Over 300 Runs",
      "Under 300 Runs",
    ];
    for (const opt of defaults) {
      const key = opt.toLowerCase();
      if (!unique.has(key)) {
        computed.push({ bet_option: opt, odds: 1.00, stake_on_option: 0 });
      }
    }

    console.log(
      `🎯 [DB] Dynamic odds computed for ${matchId}:`,
      computed.map((c) => `${c.bet_option}=${c.odds}x`).join(", ")
    );

    return computed;
  } catch (err) {
    console.error("❌ [DB] getDynamicOdds error:", err.message);
    return [
      { bet_option: "Team A to Win", odds: 1.00, stake_on_option: 0 },
      { bet_option: "Team B to Win", odds: 1.00, stake_on_option: 0 },
      { bet_option: "Draw / Tie", odds: 1.00, stake_on_option: 0 },
      { bet_option: "Over 300 Runs", odds: 1.00, stake_on_option: 0 },
      { bet_option: "Under 300 Runs", odds: 1.00, stake_on_option: 0 },
    ];
  }
}

export async function getBetById(betId) {
  try {
    const res = await pool.query(
      `SELECT id, telegram_id, match_name, bet_option, stake, status
         FROM bets
        WHERE id = $1
        LIMIT 1`,
      [betId]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error(`❌ [DB] getBetById failed for bet ${betId}:`, err.message);
    return null;
  }
}




// =====================================================
// 🧾 USER BET HISTORY + STATUS UPDATE
// =====================================================
export async function getUserBets(telegramId) {
  try {
    const res = await pool.query(
      `SELECT id, match_name, bet_option, bet_type, stake, status, created_at
         FROM bets
        WHERE telegram_id = $1
        ORDER BY created_at DESC`,
      [telegramId]
    );
    return res.rows || [];
  } catch (err) {
    console.error(`❌ [DB] Failed to fetch bets for user ${telegramId}:`, err.message);
    return [];
  }
}

export async function updateBetStatus(betId, status, resultData = null) {
  try {
    await pool.query(
      `UPDATE bets
          SET status = $2,
              result_data = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [betId, status, resultData ? JSON.stringify(resultData) : null]
    );
    console.log(`✅ [DB] Bet ${betId} updated to ${status}`);
  } catch (err) {
    console.error(`❌ [DB] Failed to update bet ${betId}:`, err.message);
  }
}
// =====================================================
// 🗑️ HOUSEKEEPING — DELETE EXPIRED MATCHES
// =====================================================
export async function deleteExpiredMatches() {
  try {
    const res = await pool.query(`
      DELETE FROM matches
       WHERE start_time < (NOW() AT TIME ZONE 'UTC' - INTERVAL '6 hours')
         AND LOWER(status) NOT IN ('live', 'in progress', 'playing')
    `);

    if (res.rowCount > 0) {
      console.log(`🧹 [DB] Purged ${res.rowCount} expired matches (>6 h old UTC).`);
    }
  } catch (err) {
    console.error("❌ [DB] Error purging expired matches:", err.message);
  }
}
// =====================================================
// 🏁 MATCH STATUS HELPERS (for CRON & Maintenance)
// =====================================================

// 🔍 Get matches that started before now but not completed
// 🔍 Get matches that started before now but are still active
export async function getPastActiveMatches() {
  try {
    const res = await pool.query(`
      SELECT 
        m.id AS match_id,
        m.api_payload->'team1'->>'teamName' AS team_a,
        m.api_payload->'team2'->>'teamName' AS team_b,
        m.api_payload->'venueInfo'->>'ground' AS venue,
        m.api_payload->>'tossStatus' AS toss_info,
        m.start_time,
        m.status
      FROM matches m
      WHERE 
        m.start_time <= NOW()
        -- ✅ Only active states
        AND LOWER(m.status) IN ('live', 'upcoming', 'scheduled', 'in progress', 'playing')
        -- 🚫 Skip matches already archived in completed_matches
        AND m.id::text NOT IN (SELECT match_id FROM completed_matches)
      ORDER BY m.start_time DESC;
    `);
    return res.rows;
  } catch (err) {
    console.error("❌ [DB] Failed to fetch past active matches:", err.message);
    return [];
  }
}

export async function getUpcomingMatches() {
  const res = await pool.query(`
    SELECT id, name, start_time
      FROM matches
     WHERE LOWER(status) IN ('upcoming', 'scheduled')
       AND start_time > NOW()
     ORDER BY start_time ASC
  `);
  return res.rows;
}



// Get all live matches (status = 'LIVE')
export async function getLiveMatches() {
  const res = await query("SELECT * FROM matches WHERE status = 'live'");
  return res.rows;
}
// Store a snapshot in live_scores
export async function insertLiveScoreSnapshot(data) {
  return query(
    `INSERT INTO live_scores 
     (match_id, over_number, ball_number, runs, wickets, total_score, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      data.match_id,
      data.over_number,
      data.ball_number,
      data.runs,
      data.wickets,
      data.total_score,
      JSON.stringify(data.source),
    ]
  );
}
async function archiveCompletedMatch(match) {
  try {
    await query(
      `
      INSERT INTO completed_matches (
        match_id, team_a, team_b, start_time, venue, toss_info, result, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (match_id) DO NOTHING;
      `,
      [
        match.match_id,   // from matches.id
        match.team_a,     // from api_payload->team1->teamname
        match.team_b,     // from api_payload->team2->teamname
        match.start_time, // from table column
        match.venue,      // from api_payload->venueinfo->ground
        match.toss_info,  // from api_payload->tossstatus
        match.result || null,
      ]
    );

    // After successful insert, remove the original record
    await query(`DELETE FROM matches WHERE id = $1`, [match.match_id]);

    console.log(`✅ [Archive] Match ${match.match_id} moved to completed_matches.`);
  } catch (err) {
    console.error(`❌ [Archive] Failed for ${match.match_id}:`, err.message);
  }
}

// Update summary text in matches table
export async function updateMatchSummary(matchId, summary) {
  return query(
    `UPDATE matches 
     SET score = $1, updated_at = NOW()
     WHERE id = $2`,
    [summary, matchId]
  );
}

// Update live match score
export async function updateMatchScore(matchId, data) {
  return query(
    `UPDATE matches 
     SET score = $1,
         wickets = $2,
         overs = $3,
         crr = $4,
         striker = $5,
         non_striker = $6,
         bowler = $7,
         updated_at = NOW()
     WHERE id = $8`,
    [
      data.runs,
      data.wickets,
      data.overs,
      data.crr,
      data.striker,
      data.nonStriker,
      data.bowler,
      matchId,
    ]
  );
}


// =====================================================
// 🏏 MATCH STATUS UPDATE HELPER
// =====================================================
export async function updateMatchStatus(matchId, newStatus) {
  try {
    await pool.query(
      `UPDATE matches
          SET status = $2, updated_at = NOW()
        WHERE id = $1`,
      [matchId, newStatus]
    );
    console.log(`✅ [DB] Match ${matchId} marked as ${newStatus}.`);
  } catch (err) {
    console.error(`❌ [DB] Failed to update match ${matchId}:`, err.message);
  }
}
// =====================================================
// 💸 DEPOSIT WATCHER HELPERS (used in depositWatcher.js)
// =====================================================

// 🔍 Fetch all user wallets that have deposit addresses
export async function getAllUserWallets(network = "TRON") {
  try {
    const res = await pool.query(
      `SELECT telegram_id, deposit_address
         FROM user_wallets
        WHERE deposit_address IS NOT NULL
          AND network = $1`,
      [network]
    );
    return res.rows;
  } catch (err) {
    console.error("❌ [DB] getAllUserWallets error:", err.message);
    return [];
  }
}

// 💰 Credit user’s balance when a deposit is detected
export async function creditUserDeposit(telegramId, amount, network = "TRON") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Ensure wallet exists
    const walletRes = await client.query(
      `SELECT deposit_address FROM user_wallets WHERE telegram_id = $1 AND network = $2`,
      [telegramId, network]
    );

    if (walletRes.rowCount === 0) {
      console.warn(`⚠️ [DB] No wallet found for user ${telegramId}, skipping credit.`);
      await client.query("ROLLBACK");
      return false;
    }

    // 2️⃣ Ensure a balances row exists
    await client.query(
      `INSERT INTO balances (telegram_id, tokens, bonus_tokens, usdt)
       VALUES ($1, 0, 200, 0)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [telegramId]
    );

    // 3️⃣ Credit USDT or G-tokens (you can adjust this logic)
    const res = await client.query(
      `UPDATE balances
         SET usdt = usdt + $1
       WHERE telegram_id = $2
       RETURNING usdt`,
      [amount, telegramId]
    );

    // 4️⃣ Mirror balances into user_wallets for real-time sync
    await client.query(
      `UPDATE user_wallets
          SET last_balance_usdt = COALESCE(last_balance_usdt, 0) + $1,
              updated_at = NOW()
        WHERE telegram_id = $2 AND network = $3`,
      [amount, telegramId, network]
    );

    await client.query("COMMIT");
    console.log(`💵 [DB] Credited ${amount} USDT to ${telegramId} (${network})`);
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ [DB] creditUserDeposit error:", err.message);
    return false;
  } finally {
    client.release();
  }
}

// =====================================================
// 🕒 MARK OLD MATCHES (>6h) AS COMPLETED
// =====================================================
// =====================================================
// 🕒 MARK OLD OR PAST MATCHES AS COMPLETED (Final Corrected Version)
// =====================================================
export async function markOldMatchesCompleted(hours = 6) {
  try {
    // 🧠 Explanation:
    // - We compare directly with NOW() because your DB stores +05:30 timezone-aware timestamps.
    // - We add OR condition for matches whose date is before today.
    // - We exclude live/in-progress/finished matches to avoid false completion.

    const res = await pool.query(
      `
      UPDATE matches
         SET status = 'completed',
             updated_at = NOW()
       WHERE start_time IS NOT NULL
         AND (
              start_time < (NOW() - ($1 || ' hours')::interval)     -- older than X hours
              OR start_time::date < CURRENT_DATE                    -- date is before today
           )
         AND LOWER(status) NOT IN (
              'completed', 'finished', 'abandoned',
              'cancelled', 'no_result', 'live', 'in progress', 'playing'
           )
    `,
      [String(hours)]
    );

    if (res.rowCount > 0) {
      console.log(
        `✅ [DB] Marked ${res.rowCount} matches as completed (>${hours}h or before today).`
      );
    } else {
      console.log("ℹ️ [DB] No matches eligible for completion.");
    }

    return res.rowCount;
  } catch (err) {
    console.error("❌ [DB] markOldMatchesCompleted error:", err.message);
    return 0;
  }
}

// =====================================================
// 🗓️ MARK MATCHES WHOSE DATE IS BEFORE TODAY AS COMPLETED
// =====================================================
export async function markPastDateMatchesCompleted() {
  try {
    const res = await pool.query(`
      UPDATE matches
         SET status = 'completed',
             updated_at = NOW()
       WHERE (start_time AT TIME ZONE 'Asia/Kolkata')::date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
         AND LOWER(status) NOT IN ('completed', 'finished', 'abandoned', 'cancelled', 'no_result')
    `);

    if (res.rowCount > 0) {
      console.log(`📅 [DB] Marked ${res.rowCount} matches (before today) as completed.`);
    } else {
      console.log("ℹ️ [DB] No matches from past days needed completion.");
    }

    return res.rowCount;
  } catch (err) {
    console.error("❌ [DB] markPastDateMatchesCompleted error:", err.message);
    return 0;
  }
}
export async function markMatchesLive() {
  const query = `
    UPDATE matches
    SET status = 'live'
    WHERE status = 'upcoming'
      AND start_date <= NOW()
      AND end_date > NOW()
    RETURNING match_id;
  `;

  const { rowCount, rows } = await pool.query(query);
  if (rowCount > 0) {
    console.log(`🔥 [DB] ${rowCount} matches moved from upcoming → live`);
  }
  return rowCount;
}

export async function markMatchesAsLive() {
  try {
    const res = await pool.query(`
      UPDATE matches
         SET status = 'live',
             updated_at = NOW()
       WHERE start_time <= NOW()
         AND LOWER(status) IN ('upcoming', 'scheduled', 'not started');
    `);

    if (res.rowCount > 0) {
      console.log(`⚡ [DB] Auto-promoted ${res.rowCount} matches to LIVE`);
    } else {
      console.log("✅ [DB] No matches needed live promotion.");
    }
  } catch (err) {
    console.error("❌ [DB] markMatchesAsLive error:", err.message);
  }
}

// =====================================================
// 🏁 FETCH COMPLETED MATCH IDS (to avoid re-saving them)
// =====================================================
export async function getCompletedMatchIds() {
  try {
    const res = await pool.query(`
      SELECT id
      FROM matches
      WHERE LOWER(status) IN (
        'completed', 'finished', 'abandoned', 'cancelled', 'no_result'
      );
    `);

    const ids = res.rows.map((r) => String(r.id));
    console.log(`📋 [DB] Loaded ${ids.length} completed match IDs.`);
    return ids;
  } catch (err) {
    console.error("❌ [DB] getCompletedMatchIds error:", err.message);
    return [];
  }
}
