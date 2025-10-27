// src/cron/depositWatcher.js
import TronWebModule from "tronweb";
const TronWeb = TronWebModule.default || TronWebModule;
import dotenv from "dotenv";
import { getAllUserWallets, creditUserDeposit, query } from "../db/db.js";
dotenv.config();

// ────────────────────────────────────────────────
// 🌐 Select network (mainnet or shasta)
// ────────────────────────────────────────────────
const NETWORK = process.env.NETWORK || "mainnet"; // set in .env → NETWORK=shasta
const IS_SHASTA = NETWORK.toLowerCase() === "shasta";

const tronWeb = new TronWeb({
  fullHost: IS_SHASTA
    ? "https://api.shasta.trongrid.io"
    : "https://api.trongrid.io",
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
});

console.log(
  `🌍 [DepositWatcher] Network selected: ${IS_SHASTA ? "SHASTA TESTNET" : "MAINNET"}`
);

// ────────────────────────────────────────────────
// 👀 Deposit Watcher Loop
// ────────────────────────────────────────────────
export function startDepositWatcher(bot) {
  console.log("👀 Deposit watcher active.");

  setInterval(async () => {
    console.log("🔁 [DepositWatcher] Checking user balances...");

    try {
      const users = await getAllUserWallets();

      for (const user of users) {
        const { telegram_id, deposit_address } = user;
        if (!deposit_address) continue;

        // ────────────────────────────────────────────────
        // 1️⃣ Get current on-chain balance
        // ────────────────────────────────────────────────
        const balanceInSun = await tronWeb.trx.getBalance(deposit_address);
        const trxBalance = Number(tronWeb.fromSun(balanceInSun));

        // Optional: also check USDT TRC-20 contract
        let usdtBalance = 0;
        try {
          const usdtContract =
            process.env.USDT_CONTRACT_ADDRESS ||
            "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"; // mainnet USDT
          const usdtInstance = await tronWeb.contract().at(usdtContract);
          const bal = await usdtInstance.balanceOf(deposit_address).call();
          usdtBalance = Number(tronWeb.fromSun(bal));
        } catch {
          // skip quietly
        }

        console.log(
          `👤 [${telegram_id}] TRX=${trxBalance} | USDT=${usdtBalance} @ ${deposit_address}`
        );

        // ────────────────────────────────────────────────
        // 2️⃣ Compare with previous DB snapshot
        // ────────────────────────────────────────────────
        const prevRes = await query(
          `SELECT last_balance_trx, last_balance_usdt
             FROM users WHERE telegram_id = $1`,
          [telegram_id]
        );
        const prev =
          prevRes.rows[0] || { last_balance_trx: 0, last_balance_usdt: 0 };

        const diffTRX = Math.max(trxBalance - Number(prev.last_balance_trx || 0), 0);
        const diffUSDT = Math.max(usdtBalance - Number(prev.last_balance_usdt || 0), 0);

        // ────────────────────────────────────────────────
        // 3️⃣ Credit only *new deposits*
        // ────────────────────────────────────────────────
        if (diffTRX > 0.001 || diffUSDT > 0.001) {
          // Choose which token type to credit
          const isUSDT = diffUSDT > 0.001;
          const creditTokenType = isUSDT ? "USDT" : "TRX";
          const rawAmount = isUSDT ? diffUSDT : diffTRX;

          // ⚙️ Conversion logic
          // Currently: 1 TRX = 10 G-Tokens
          // (Later you can switch to 1 USDT = 1 G-Token)
          const conversionRate = isUSDT ? 1 : 10;
          const gTokens = rawAmount * conversionRate;

          // 🪙 Credit to user balance
          await creditUserDeposit(telegram_id, gTokens);

          // 🧾 Update snapshot in `users`
          await query(
            `UPDATE users
               SET last_balance_trx = $1,
                   last_balance_usdt = $2,
                   last_deposit = NOW()
             WHERE telegram_id = $3`,
            [trxBalance, usdtBalance, telegram_id]
          );

          // ✅ Notify user
          await bot.telegram.sendMessage(
            telegram_id,
            `💰 *Deposit Detected!*\n` +
              `You sent ${rawAmount.toFixed(3)} ${creditTokenType}.\n` +
              `🎯 Credited *${gTokens.toFixed(2)} G-Tokens* to your wallet.\n\n` +
              `Your G-Token balance has been updated ✅`,
            { parse_mode: "Markdown" }
          );

          console.log(
            `✅ [DepositWatcher] Credited ${gTokens.toFixed(2)} G for ${telegram_id}`
          );
        } else {
          // No new deposits — just keep snapshot fresh
          await query(
            `UPDATE users
               SET last_balance_trx = $1,
                   last_balance_usdt = $2
             WHERE telegram_id = $3`,
            [trxBalance, usdtBalance, telegram_id]
          );
        }
      }
    } catch (err) {
      console.error("❌ [DepositWatcher] Error:", err.message);
    }
  }, 10000_000); // every 60 sec
}
