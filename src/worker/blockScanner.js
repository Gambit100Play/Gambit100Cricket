
// src/worker/blockScanner.js
import dotenv from "dotenv";
dotenv.config();

import { tronWeb } from "../wallet/masterWallet.js";
import { query } from "../db/db.js";
import { logger } from "../utils/logger.js"; // your logger
import { getUserByDepositAddress } from "../db/users_helpers.js"; // helper that returns user by deposit_address

const POLL_INTERVAL_MS = 4000;
const CONFIRMATIONS = Number(process.env.DEPOSIT_CONFIRMATIONS || 3);

let lastScannedBlock = null;

async function loadLastScannedBlock() {
  const { rows } = await query("SELECT block_number FROM chain_state WHERE key='last_scanned_block' LIMIT 1");
  if (rows.length) return Number(rows[0].block_number);
  return null;
}
async function saveLastScannedBlock(blk) {
  await query(`
    INSERT INTO chain_state (key, block_number) VALUES ('last_scanned_block', $1)
    ON CONFLICT (key) DO UPDATE SET block_number = EXCLUDED.block_number
  `, [blk]);
}

/** Inspect single tx, return deposit info or null */
async function inspectTransaction(tx) {
  // typical tx fields: txID, raw_data, raw_data.contract[]
  const txid = tx.txID || tx.txid || tx.hash;
  try {
    // 1) TRX native transfer detection:
    const contracts = (tx.raw_data && tx.raw_data.contract) || [];
    for (const c of contracts) {
      const type = c.type;
      const val = c.parameter?.value || {};
      // TRX transfer contract type name varies; commonly 'TransferContract'
      if (type === "TransferContract" && val.to_address && val.amount) {
        const to = tronWeb.address.fromHex(val.to_address);
        const amountSun = Number(val.amount); // already SUN
        return {
          txid,
          to,
          token: "TRX",
          amountSun,
          amount: amountSun / 1e6,
          decimals: 6,
        };
      }
      // For TRC20 impulse, type = 'TriggerSmartContract' and parameter contains data for transfer
      if (type === "TriggerSmartContract") {
        // We need to decode TRC20 transfer: it's an ABI-encoded method call 'transfer(address,uint256)'
        // Easiest: call getEventByTransactionID to fetch Transfer events
      }
    }

    // 2) Try to get events (TRC20 Transfer) if node supports it:
    try {
      const events = await tronWeb.getEventByTransactionID(txid);
      // events returns array of event objects; search for Transfer events
      for (const ev of events || []) {
        if (!ev || !ev.event) continue;
        if (ev.event === "Transfer") {
          // typical ev.result: { from: '...', to: '...', value: '...' }
          const { to, value } = ev.result;
          if (!to) continue;
          const toAddr = tronWeb.address.fromHex(to);
          const decimals = ev.decimals != null ? Number(ev.decimals) : 6; // best-effort
          const amount = Number(value) / (10 ** (decimals || 6));
          return {
            txid,
            to: toAddr,
            token: (ev.contract || ev.name) ? "USDT-TRC20" : "TRC20",
            amount,
            amountSun: Number(value),
            decimals: decimals || 6,
            metadata: ev
          };
        }
      }
    } catch (e) {
      logger.debug("getEventByTransactionID not supported or failed:", e.message);
    }

    return null;
  } catch (err) {
    logger.error("inspectTransaction error:", err);
    return null;
  }
}

async function processDeposit(deposit) {
  const { txid, to, token, amount, amountSun, decimals } = deposit;
  // find user by deposit address
  const user = await query("SELECT telegram_id FROM users WHERE deposit_address = $1 LIMIT 1", [to]);
  if (!user.rows.length) {
    logger.info(`Deposit to non-user address ${to} (tx=${txid})`);
    return;
  }
  const telegram_id = user.rows[0].telegram_id;

  // idempotent insertion
  try {
    await query("BEGIN");
    // prevent double-processing
    const { rows: exists } = await query("SELECT txid FROM transactions WHERE txid=$1 FOR UPDATE", [txid]);
    if (exists.length) {
      logger.info(`TX ${txid} already processed`);
      await query("ROLLBACK");
      return;
    }

    await query(
      `INSERT INTO transactions (txid, telegram_id, deposit_address, token, amount, amount_sun, decimals, status, block_number, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [txid, telegram_id, to, token, amount, amountSun || null, decimals || 6, 'pending', deposit.blockNumber || null, JSON.stringify(deposit.metadata || {})]
    );

    // If confirmations are enough you can credit immediately or wait until tx confirmed.
    // For now, leave as pending and let confirmation pass update status.
    await query("COMMIT");
    logger.info(`Inserted pending deposit ${txid} for user=${telegram_id} amount=${amount} ${token}`);
  } catch (err) {
    await query("ROLLBACK");
    logger.error("Failed to write deposit:", err);
  }
}

export async function scanLoop() {
  lastScannedBlock = await loadLastScannedBlock();
  if (!lastScannedBlock) {
    // safe initial: start from current block - 2
    const latestBlock = await tronWeb.trx.getCurrentBlock();
    lastScannedBlock = latestBlock.block_header.raw_data.number - 2;
  }

  setInterval(async () => {
    try {
      const latest = (await tronWeb.trx.getCurrentBlock()).block_header.raw_data.number;
      // scan blocks > lastScannedBlock up to latest
      for (let b = lastScannedBlock + 1; b <= latest; b++) {
        const block = await tronWeb.trx.getBlock(b);
        const txs = block.transactions || [];
        for (const tx of txs) {
          const deposit = await inspectTransaction(tx);
          if (deposit) {
            deposit.blockNumber = b;
            deposit.blockTimestamp = block.block_header.raw_data.timestamp;
            deposit.txRaw = tx;
            await processDeposit(deposit);
          }
        }
        await saveLastScannedBlock(b);
        lastScannedBlock = b;
      }

      // After scanning new blocks, optionally update confirmations and mark confirmed deposits
      await updateConfirmationsAndSettle(latest);

    } catch (err) {
      logger.error("scanLoop error:", err);
    }
  }, POLL_INTERVAL_MS);
}

async function updateConfirmationsAndSettle(latestBlockNumber) {
  // find all pending transactions
  const { rows } = await query(`
    SELECT txid, deposit_address, telegram_id, amount, token
    FROM transactions
    WHERE status = 'pending'
  `);

  for (const r of rows) {
    // get transaction info to verify block inclusion
    const info = await tronWeb.trx.getTransactionInfo(r.txid).catch(() => null);
    if (!info || !info.blockNumber) continue;

    const confirmations = latestBlockNumber - info.blockNumber + 1;

    if (confirmations >= CONFIRMATIONS) {
      // enough confirmations — mark confirmed + credit user
      await query("BEGIN");
      try {
        // ✅ Mark transaction as confirmed
        await query(
          `UPDATE transactions
             SET status = 'confirmed',
                 confirmations = $1,
                 processed_at = NOW()
           WHERE txid = $2`,
          [confirmations, r.txid]
        );

        // ✅ Determine TRX → token conversion rate
        const { rows: rateRows } = await query(
          "SELECT value FROM settings WHERE key='trx_to_token_rate' LIMIT 1"
        );
        const rate = rateRows.length ? Number(rateRows[0].value) : 10; // default 1 TRX = 10 tokens
        const tokensToCredit = Number(r.amount) * rate;

        // ✅ Credit tokens into balances table
        await query(
          `INSERT INTO balances (telegram_id, tokens, bonus_tokens, usdt)
           VALUES ($1, $2, 0, 0)
           ON CONFLICT (telegram_id)
           DO UPDATE
             SET tokens = balances.tokens + EXCLUDED.tokens`,
          [r.telegram_id, tokensToCredit]
        );

        await query("COMMIT");
        logger.info(
          `💎 Credited ${tokensToCredit} tokens to user=${r.telegram_id} (tx=${r.txid})`
        );

        // ✅ Optional: notify user through Telegram (if bot available)
        try {
          if (global.bot) {
            await global.bot.telegram.sendMessage(
              r.telegram_id,
              `✅ *Deposit Confirmed!*\nYou sent *${r.amount} TRX* and received *${tokensToCredit} Gaming Tokens* 🎮`,
              { parse_mode: "Markdown" }
            );
          }
        } catch (notifyErr) {
          logger.warn(
            `⚠️ [Notify] Failed to notify user=${r.telegram_id}: ${notifyErr.message}`
          );
        }
      } catch (err) {
        await query("ROLLBACK");
        logger.error(`❌ [SettleDeposit] ${err.message}`);
      }
    } else {
      // still waiting on confirmations
      await query(
        "UPDATE transactions SET confirmations = $1 WHERE txid = $2",
        [confirmations, r.txid]
      );
    }
  }
}

