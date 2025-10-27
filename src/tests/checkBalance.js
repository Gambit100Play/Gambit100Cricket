// src/tests/check-balance.js
import pkg from "tronweb";
import dotenv from "dotenv";
dotenv.config();

const { TronWeb } = pkg;

// ────────────────────────────────────────────────
// 🌐 Use Shasta testnet (or Mainnet based on .env)
// ────────────────────────────────────────────────
const NETWORK = process.env.NETWORK || "shasta";
const IS_SHASTA = NETWORK.toLowerCase() === "shasta";

const tronWeb = new TronWeb({
  fullHost: IS_SHASTA
    ? "https://api.shasta.trongrid.io" // ✅ Shasta testnet
    : "https://api.trongrid.io",        // 🚀 Mainnet
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
});

const walletAddress = "TJqauAUa9KBz1V9Yxzgs74EJGFz1QqCQEB";

async function checkBalance() {
  try {
    // ────────────────
    // 🔹 TRX balance
    // ────────────────
    const balanceInSun = await tronWeb.trx.getBalance(walletAddress);
    const balanceInTRX = Number(tronWeb.fromSun(balanceInSun));

    // ────────────────
    // 💵 USDT (optional)
    // ────────────────
    let usdtBalance = 0;
    try {
      const usdtContract =
        process.env.USDT_CONTRACT_ADDRESS ||
        "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs"; // Shasta USDT test contract
      const usdtInstance = await tronWeb.contract().at(usdtContract);
      const rawBal = await usdtInstance.balanceOf(walletAddress).call();
      usdtBalance = Number(tronWeb.fromSun(rawBal));
    } catch {
      usdtBalance = 0; // ignore missing token balance
    }

    // ────────────────
    // 🖨️ Log results
    // ────────────────
    console.clear();
    console.log(`🕒 ${new Date().toLocaleTimeString()} — [${IS_SHASTA ? "SHASTA" : "MAINNET"}]`);
    console.log(`💰 Wallet: ${walletAddress}`);
    console.log(`🔹 TRX Balance: ${balanceInTRX} TRX`);
    console.log(`💵 USDT Balance: ${usdtBalance} USDT`);
  } catch (err) {
    console.error("❌ Failed to fetch balance:", err.message);
  }
}

// ────────────────────────────────────────────────
// 🔁 Run every minute
// ────────────────────────────────────────────────
console.log("⏳ Starting balance watcher (1-minute interval)...");
await checkBalance();
setInterval(checkBalance, 60 * 1000); // 1 minute
