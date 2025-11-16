// ============================================================
// 👀 Deposit Watcher — Redis Safe (v2.0)
// ============================================================
//
// Adds:
//   ✔ Redis Distributed Lock → only ONE deposit scan can run
//   ✔ Safe new-deposit detection
//   ✔ No double-credit even under concurrency
//   ✔ Works even if bot restarts or interval overlaps
// ============================================================

// TronWeb
import TronWebModule from "tronweb";
import dotenv from "dotenv";

// DB + Logging
import { getAllUserWallets, creditUserDeposit, query } from "../db/db.js";
import { logger } from "../utils/logger.js";

// Redis locking
import { acquireLock, releaseLock } from "../redis/locks.js";

dotenv.config();

// ────────────────────────────────────────────────
// 📴 Suppress TronWeb console spam
// ────────────────────────────────────────────────
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// Resolve TronWeb export differences
const TronWeb =
  TronWebModule.TronWeb || TronWebModule.default || TronWebModule;

// ────────────────────────────────────────────────
// 🌍 Network Setup
// ────────────────────────────────────────────────
const NETWORK = process.env.NETWORK || "mainnet";
const IS_SHASTA = NETWORK.toLowerCase() === "shasta";

const tronWeb = new TronWeb({
  fullHost: IS_SHASTA
    ? "https://api.shasta.trongrid.io"
    : "https://api.trongrid.io",
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
  privateKey: process.env.TRON_PRIVATE_KEY || "",
});

logger.info(
  `🌍 [DepositWatcher] Network selected: ${
    IS_SHASTA ? "SHASTA TESTNET" : "MAINNET"
  }`
);

// ────────────────────────────────────────────────
// 🔁 Deposit Watcher Loop (safe)
// ────────────────────────────────────────────────
export function startDepositWatcher(bot) {
  logger.info("👀 [DepositWatcher] Active and monitoring deposits...");

  setInterval(async () => {
    logger.info("🔁 [DepositWatcher] Checking user balances...");

    // ============================================================
    // 🚫 Redis Lock — prevents double deposit scans
    // ============================================================
    const lockKey = "lock:deposit-watcher";
    const locked = await acquireLock(lockKey, 55000); // allow only 1 per 55s

    if (!locked) {
      logger.warn("⏳ [DepositWatcher] Another scan is already running. Skipping.");
      return;
    }

    try {
      const users = await getAllUserWallets();
      if (!users?.length) {
        logger.warn("⚠️ No user wallets found for balance check.");
        return;
      }

      for (const user of users) {
        const { telegram_id, deposit_address } = user;
        if (!deposit_address) continue;

        try {
          // ────────────────────────────────────────────────
          // 1️⃣ On-chain balances (TRX + USDT)
          // ────────────────────────────────────────────────
          const balanceInSun = await tronWeb.trx.getBalance(deposit_address);
          const trxBalance = Number(tronWeb.fromSun(balanceInSun));

          let usdtBalance = 0;
          try {
            const usdtContract =
              process.env.USDT_CONTRACT_ADDRESS ||
              "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"; // Mainnet USDT

            const contract = await tronWeb.contract().at(usdtContract);
            const bal = await contract.balanceOf(deposit_address).call();
            usdtBalance = Number(tronWeb.fromSun(bal));
          } catch (usdtErr) {
            logger.warn(`⚠️ [DepositWatcher] USDT check skipped: ${usdtErr.message}`);
          }

          logger.info(
            `👤 [${telegram_id}] TRX=${trxBalance} | USDT=${usdtBalance} @ ${deposit_address}`
          );

          // ────────────────────────────────────────────────
          // 2️⃣ Compare with previous DB snapshot
          // ────────────────────────────────────────────────
          const prevRes = await query(
            `SELECT last_balance_trx, last_balance_usdt 
             FROM users 
             WHERE telegram_id = $1`,
            [telegram_id]
          );

          const prev =
            prevRes.rows[0] || { last_balance_trx: 0, last_balance_usdt: 0 };

          const diffTRX = Math.max(trxBalance - Number(prev.last_balance_trx || 0), 0);
          const diffUSDT = Math.max(usdtBalance - Number(prev.last_balance_usdt || 0), 0);

          // ────────────────────────────────────────────────
          // 3️⃣ Credit ONLY NEW deposits (difference-based)
          // ────────────────────────────────────────────────
          if (diffTRX > 0.001 || diffUSDT > 0.001) {
            const isUSDT = diffUSDT > 0.001;
            const creditTokenType = isUSDT ? "USDT" : "TRX";
            const rawAmount = isUSDT ? diffUSDT : diffTRX;

            // Conversion: 1 USDT = 1 GT, 1 TRX = 10 GT
            const conversionRate = isUSDT ? 1 : 10;
            const gTokens = rawAmount * conversionRate;

            // Credit new deposit
            await creditUserDeposit(telegram_id, gTokens);

            // Update DB balances
            await query(
              `UPDATE users
               SET last_balance_trx = $1,
                   last_balance_usdt = $2,
                   last_deposit = NOW()
               WHERE telegram_id = $3`,
              [trxBalance, usdtBalance, telegram_id]
            );

            // Notify user
            await bot.telegram
              .sendMessage(
                telegram_id,
                `💰 *Deposit Detected!*\n` +
                  `You sent ${rawAmount.toFixed(3)} ${creditTokenType}.\n` +
                  `🎯 Credited *${gTokens.toFixed(2)} G-Tokens* to your wallet.\n\n` +
                  `Your G-Token balance has been updated ✅`,
                { parse_mode: "Markdown" }
              )
              .catch(() => {});

            logger.info(
              `✅ [DepositWatcher] Credited ${gTokens.toFixed(
                2
              )} G for Telegram user ${telegram_id}`
            );
          } else {
            // Just update snapshot, no new deposit
            await query(
              `UPDATE users
               SET last_balance_trx = $1,
                   last_balance_usdt = $2
               WHERE telegram_id = $3`,
              [trxBalance, usdtBalance, telegram_id]
            );
          }
        } catch (innerErr) {
          logger.error(
            `❌ [DepositWatcher] Error for "${user.telegram_id}": ${innerErr.message}`
          );
        }
      }
    } catch (err) {
      logger.error(`💥 [DepositWatcher] Global error: ${err.message}`);
    } finally {
      // release redis lock
      await releaseLock(lockKey);
      logger.info("🔓 [DepositWatcher] Lock released.");
    }
  }, 60000); // every 60 seconds
}
