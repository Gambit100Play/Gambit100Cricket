import pkg from "pg";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import { getPoolInfo, getPoolStatus } from "./poolLogic.js";

dotenv.config();
const { Pool } = pkg;

// =====================================================
// 🔑 Database Connection Pool
// =====================================================
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// =====================================================
// 🧩 Generic Query Helper
// =====================================================
export async function query(text, params) {
  return pool.query(text, params);
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
export async function saveUserWallet(telegramId, { withdrawal_address, deposit_address }) {
  await pool.query(
    `INSERT INTO users (telegram_id, withdrawal_address, deposit_address, last_active)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       withdrawal_address = $2,
       deposit_address = $3,
       last_active = NOW()`,
    [telegramId, withdrawal_address, deposit_address]
  );
}

export async function getUserWallet(telegramId) {
  const res = await pool.query(
    `SELECT withdrawal_address, deposit_address FROM users WHERE telegram_id = $1`,
    [telegramId]
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


export async function saveMatch(match) {
  try {
    // ✅ Convert UTC to IST (Asia/Kolkata)
    let startDate = null;
    let startTimeLocal = null;

    if (match.start_time) {
      const dtUTC = DateTime.fromISO(match.start_time, { zone: "utc" });
      const dtIST = dtUTC.setZone("Asia/Kolkata");

      startDate = dtIST.toFormat("yyyy-LL-dd");
      startTimeLocal = dtIST.toFormat("HH:mm:ss");
    }

    // Skip matches older than 6 hours
    if (startDate && startTimeLocal) {
      const matchTime = DateTime.fromISO(match.start_time, { zone: "utc" });
      const nowUTC = DateTime.utc();
      const hoursDiff = nowUTC.diff(matchTime, "hours").hours;
      if (hoursDiff > 6) {
        console.log(`⛔ [DB] Skipping save for expired match: ${match.name}`);
        return;
      }
    }

    await pool.query(
      `INSERT INTO matches (id, name, start_time, start_date, start_time_local, status, score, api_payload, updated_at)
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
        match.start_time,      // original UTC
        startDate,             // IST date
        startTimeLocal,        // IST time
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


    await client.query("COMMIT");
    return { bet: betRes.rows[0], balance: { tokens, bonus, usdt } };
  } catch (err) {
    await client.query("ROLLBACK");
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


export async function getDynamicOdds(matchId, marketType = "PreMatch") {
  try {
    const poolInfo = await getPoolInfo(matchId, marketType);
    const status = poolInfo.status || getPoolStatus(poolInfo.participants);

    // 💤 Pending pool: show 1.00x odds for all markets
    if (status === "pending") {
      return [
        { bet_option: "Team A to Win", odds: 1.00, stake_on_option: 0 },
        { bet_option: "Team B to Win", odds: 1.00, stake_on_option: 0 },
        { bet_option: "Draw / Tie", odds: 1.00, stake_on_option: 0 },
        { bet_option: "Over 300 Runs", odds: 1.00, stake_on_option: 0 },
        { bet_option: "Under 300 Runs", odds: 1.00, stake_on_option: 0 },
      ];
    }

    // ✅ Active pool: calculate dynamic odds based on stake distribution
    const totalStake = poolInfo.totalStake || 1;

    return poolInfo.rows.map((r) => {
      const stake = Number(r.total_stake || 0);
      const share = stake / totalStake;

      // 🧠 Odds formula: (1 / share) * 0.9 (10% margin)
      const fairOdds = 1 / Math.max(share, 0.05); // avoid div by zero
      const adjusted = fairOdds * 0.9;
      const dynamic = Math.min(Math.max(adjusted, 1.1), 10.0); // clamp between 1.1–10x

      return {
        bet_option: r.bet_option,
        odds: Number(dynamic.toFixed(2)),
        stake_on_option: stake,
      };
    });
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
export async function getPastActiveMatches() {
  try {
    const res = await pool.query(`
      SELECT *
      FROM matches
      WHERE start_time <= NOW()
        AND LOWER(status) IN ('live', 'upcoming', 'scheduled')
      ORDER BY start_time DESC;
    `);
    return res.rows;
  } catch (err) {
    console.error("❌ [DB] Failed to fetch past active matches:", err.message);
    return [];
  }
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
export async function getAllUserWallets() {
  try {
    const res = await pool.query(
      `SELECT telegram_id, deposit_address FROM users WHERE deposit_address IS NOT NULL`
    );
    return res.rows;
  } catch (err) {
    console.error("❌ [DB] getAllUserWallets error:", err);
    return [];
  }
}

// 💰 Credit user’s balance when a deposit is detected
export async function creditUserDeposit(telegramId, amount) {
  try {
    // 🧠 1️⃣ Ensure the user has a balance record
    await pool.query(
      `INSERT INTO balances (telegram_id, tokens, bonus_tokens, usdt)
       VALUES ($1, 0, 200, 0)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [telegramId]
    );

    // 🪙 2️⃣ Add credited amount to tokens
    const res = await pool.query(
      `UPDATE balances
         SET tokens = tokens + $1
       WHERE telegram_id = $2
       RETURNING tokens`,
      [amount, telegramId]
    );

    if (res.rowCount === 0) {
      console.warn(`⚠️ [DB] No balance row found for user ${telegramId}`);
    } else {
      console.log(`💵 [DB] Credited ${amount} G-Tokens to user ${telegramId}`);
    }

    // 🕓 3️⃣ Update user's last deposit timestamp
    await pool.query(
      `UPDATE users
         SET last_deposit = NOW()
       WHERE telegram_id = $1`,
      [telegramId]
    );
  } catch (err) {
    console.error("❌ [DB] creditUserDeposit error:", err.message);
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
