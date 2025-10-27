// src/bot/handlers/checkBalanceHandler.js
import TronWebModule from "tronweb";
const TronWeb = TronWebModule.default || TronWebModule;
import dotenv from "dotenv";
import { getUserWallet, getUserBalance } from "../../db/db.js";

dotenv.config();


// ────────────────────────────────────────────────
// 🌐 Select Mainnet or Shasta
// ────────────────────────────────────────────────
const NETWORK = process.env.NETWORK || "mainnet";
const IS_SHASTA = NETWORK.toLowerCase() === "shasta";

const tronWeb = new TronWeb({
  fullHost: IS_SHASTA
    ? "https://api.shasta.trongrid.io"
    : "https://api.trongrid.io",
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
});

export default function checkBalanceHandler(bot) {
  // 💰 Handle "Check Balance" button
  bot.action("show_balance", async (ctx) => {
    await ctx.answerCbQuery("Fetching balance...");
    const telegramId = ctx.from.id;

    try {
      // 1️⃣ Fetch user wallet from DB
      const userWallet = await getUserWallet(telegramId);
      if (!userWallet?.deposit_address) {
        return ctx.reply(
          "⚠️ You don’t have a deposit address yet.\nUse /wallet or ‘Connect Wallet’ to set one."
        );
      }

      const depositAddress = userWallet.deposit_address;

      // 2️⃣ Fetch on-chain TRX + USDT balances
      const balanceInSun = await tronWeb.trx.getBalance(depositAddress);
      const trxBalance = Number(tronWeb.fromSun(balanceInSun));

      let usdtBalance = 0;
      try {
        const usdtContract =
          process.env.USDT_CONTRACT_ADDRESS ||
          "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"; // mainnet USDT
        const contract = await tronWeb.contract().at(usdtContract);
        const bal = await contract.balanceOf(depositAddress).call();
        usdtBalance = Number(tronWeb.fromSun(bal));
      } catch (err) {
        console.log("⚠️ USDT check skipped:", err.message);
      }

      // 3️⃣ Fetch G-Token balance from DB
      const tokenBal = await getUserBalance(telegramId);

      // 4️⃣ Format & send reply
      const message =
        `💼 *CricPredict Wallet Summary*\n\n` +
        `📥 *Deposit Address:*\n\`${depositAddress}\`\n\n` +
        `🌐 *Network:* ${IS_SHASTA ? "Shasta Testnet" : "TRON Mainnet"}\n\n` +
        `💎 *On-Chain Balances:*\n` +
        `• TRX: ${trxBalance}\n` +
        `• USDT: ${usdtBalance}\n\n` +
        `🎯 *In-App G-Token Balance:*\n` +
        `• Tokens: ${tokenBal.tokens}\n` +
        `• Bonus: ${tokenBal.bonus_tokens}\n` +
        `• USDT Equivalent: ${tokenBal.usdt}\n\n` +
        `1 USDT = 1 G-Token`;

      await ctx.reply(message, { parse_mode: "Markdown" });
    } catch (err) {
      console.error("❌ [CheckBalance] Error:", err);
      await ctx.reply("⚠️ Could not fetch wallet balance. Please try again later.");
    }
  });
}
