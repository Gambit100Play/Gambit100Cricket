// ============================================================
// 🪙 Payout Processor (Redis + SQL Safe) — v2.1 (Final Updated)
// ============================================================
//
// Guarantees:
//   ✔ Global Redis Lock → only ONE payout cycle runs at a time
//   ✔ Row-level safety using FOR UPDATE SKIP LOCKED
//   ✔ Safe payouts with TRON TRC20 tokens
//   ✔ Auto-fails too-small withdrawals
//   ✔ Auto-handles user notifications
// ============================================================

import { query } from "../db/db.js";
import { logger } from "../utils/logger.js";
import { sendTRC20 } from "../utils/sendTrc20.js";

// Redis distributed locks
import { acquireLock, releaseLock } from "../redis/locks.js";

// ------------------------------------------------------------
// ⚙️ Helper → fetch a setting from DB with fallback
// ------------------------------------------------------------
async function getSetting(key, def = null) {
  const { rows } = await query(
    "SELECT value FROM settings WHERE key=$1 LIMIT 1",
    [key]
  );
  return rows.length ? rows[0].value : def;
}

// ------------------------------------------------------------
// 🚀 Main Payout Cycle
// ------------------------------------------------------------
export async function runPayoutCycle(batch = 10) {
  const lockKey = "lock:payout-cycle";

  // ------------------------------------------------------------
  // 1️⃣ Redis Lock → ensures single payout executor
  // ------------------------------------------------------------
  const locked = await acquireLock(lockKey, 20000); // 20 sec TTL
  if (!locked) {
    logger.warn("⏳ [Payout] Another payout cycle already running. Skipping.");
    return;
  }

  logger.info("🪙 [Payout] Starting payout cycle...");

  try {
    // ------------------------------------------------------------
    // 2️⃣ Load contract settings
    // ------------------------------------------------------------
    const contract = await getSetting("usdt_trc20_contract");
    const decimals = Number(await getSetting("tron_token_decimals", "6"));
    const minWithdrawUSDT = Number(await getSetting("min_withdraw_usdt", "100"));

    if (!contract) {
      logger.warn("⚠️ [Payout] Missing setting: usdt_trc20_contract");
      return;
    }

    // ------------------------------------------------------------
    // 3️⃣ Claim pending withdrawals atomically
    // ------------------------------------------------------------
    const { rows: items } = await query(
      `
      WITH cte AS (
        SELECT id
        FROM withdrawals
        WHERE status = 'pending'
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE withdrawals w
      SET status = 'processing'
      FROM cte
      WHERE w.id = cte.id
      RETURNING w.id, w.telegram_id, w.amount, w.to_address, w.token
      `,
      [batch]
    );

    if (!items.length) {
      logger.info("💤 [Payout] No pending withdrawals.");
      return;
    }

    logger.info(`📦 [Payout] Processing ${items.length} withdrawal(s)...`);

    // ------------------------------------------------------------
    // 4️⃣ Process each withdrawal safely
    // ------------------------------------------------------------
    for (const w of items) {
      try {
        const amt = Number(w.amount);

        // Minimum withdrawal rule
        if (amt < minWithdrawUSDT) {
          const reason = `Below minimum withdrawal: ${amt} < ${minWithdrawUSDT}`;
          await query(
            "UPDATE withdrawals SET status='failed', failure_reason=$2 WHERE id=$1",
            [w.id, reason]
          );
          logger.warn(`❌ [Payout] ${w.id} failed — ${reason}`);
          continue;
        }

        // --------------------------------------------------------
        // 🔥 Execute on-chain payout
        // --------------------------------------------------------
        const txid = await sendTRC20({
          to: w.to_address,
          amount: amt,
          contract,
          decimals,
        });

        // --------------------------------------------------------
        // 🟢 Mark as sent
        // --------------------------------------------------------
        await query(
          `
          UPDATE withdrawals
          SET status='sent',
              txid=$2,
              processed_at=NOW()
          WHERE id=$1
          `,
          [w.id, txid]
        );

        // Notify user (non-blocking)
        if (global.bot) {
          global.bot.telegram
            .sendMessage(
              String(w.telegram_id),
              `✅ Withdrawal of ${amt} USDT sent.\nTx: \`${txid}\``,
              { parse_mode: "Markdown" }
            )
            .catch(() => {});
        }

        logger.info(
          `✅ [Payout] id=${w.id} → Sent ${amt} USDT to ${w.to_address}`
        );
      } catch (err) {
        const reason = (err.message || "unknown error").slice(0, 2000);

        await query(
          "UPDATE withdrawals SET status='failed', failure_reason=$2 WHERE id=$1",
          [w.id, reason]
        );

        logger.error(`❌ [Payout] id=${w.id} failed → ${reason}`);
      }
    }
  } finally {
    // ------------------------------------------------------------
    // 5️⃣ Release Redis Lock
    // ------------------------------------------------------------
    await releaseLock(lockKey);
    logger.info("🔓 [Payout] Cycle complete — lock released.");
  }
}
