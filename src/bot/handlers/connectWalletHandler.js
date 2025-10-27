// src/bot/handlers/connectWalletHandler.js
import * as TronWebNS from "tronweb";
import dotenv from "dotenv";
import { Markup } from "telegraf";
import { saveUserWallet, getUserWallet } from "../../db/db.js";
import { getAddressForUser } from "../../utils/wallet.js";

dotenv.config();

// ✅ Works with both tronweb v5 (CJS) and v6 (ESM)
const TronWeb = TronWebNS.TronWeb ?? TronWebNS.default ?? TronWebNS;

if (typeof TronWeb !== "function") {
  console.error("[tronweb] export keys:", Object.keys(TronWebNS || {}));
  throw new Error(
    "tronweb import did not expose a constructor. " +
      "Check your installed version with `npm ls tronweb` and ensure only one version is installed."
  );
}

// ────────────────────────────────────────────────
// 🌐 Select Mainnet or Shasta
// ────────────────────────────────────────────────
const NETWORK = (process.env.NETWORK || "mainnet").toLowerCase();
const IS_SHASTA = NETWORK === "shasta";

const tronWeb = new TronWeb({
  fullHost: IS_SHASTA ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io",
  headers: process.env.TRONGRID_API_KEY
    ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
    : undefined,
  // privateKey not needed here (read-only ops)
});

// Track users expected to paste a withdrawal address
const waitingForWithdrawAddr = new Map();

// Simple validators
function isValidTronAddress(addr) {
  try {
    return !!addr && tronWeb.isAddress(addr);
  } catch {
    return false;
  }
}

// UI builders
function walletMenuKeyboard(hasWithdraw, hasDeposit) {
  const rows = [];
  rows.push([
    Markup.button.callback("🔗 Link Withdrawal Wallet", "link_withdraw_wallet"),
    Markup.button.callback("📥 Get Deposit Address", "get_deposit_address"),
  ]);
  if (hasWithdraw || hasDeposit) {
    rows.push([Markup.button.callback("🔄 Refresh", "wallet_menu")]);
  }
  return Markup.inlineKeyboard(rows);
}

// ────────────────────────────────────────────────
// 📲 Main handler (DEFAULT EXPORT)
// ────────────────────────────────────────────────
export default function connectWalletHandler(bot) {
  // 🧭 Wallet menu
  bot.action("wallet_menu", async (ctx) => {
    await ctx.answerCbQuery();

    const telegramId = ctx.from.id;
    const userWallet = await getUserWallet(telegramId).catch(() => null);

    const withdraw = userWallet?.withdrawal_address || "Not linked";
    const deposit = userWallet?.deposit_address || "Not issued";

    const text =
      `💼 *Your CricPredict Wallet*\n\n` +
      `🌐 *Network:* ${IS_SHASTA ? "Shasta Testnet" : "TRON Mainnet"}\n\n` +
      `📤 *Withdrawal Wallet:*\n\`${withdraw}\`\n\n` +
      `📥 *Deposit Address:*\n\`${deposit}\`\n\n` +
      `• Use *Withdrawal Wallet* to receive payouts to your own TRON address.\n` +
      `• Use *Deposit Address* to top-up G-Tokens (USDT/TRX → platform balance).`;

    return ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...walletMenuKeyboard(!!userWallet?.withdrawal_address, !!userWallet?.deposit_address),
    }).catch(async () => {
      // If not an edit-able message, send a new one
      return ctx.reply(text, {
        parse_mode: "Markdown",
        ...walletMenuKeyboard(!!userWallet?.withdrawal_address, !!userWallet?.deposit_address),
      });
    });
  });

  // 🔗 Begin linking a withdrawal wallet
  bot.action("link_withdraw_wallet", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;

    waitingForWithdrawAddr.set(telegramId, true);
    return ctx.reply(
      "Paste your *TRON (TRX/USDT-TRC20)* wallet address (starts with `T...`).",
      { parse_mode: "Markdown" }
    );
  });

  // 📥 Issue / show deposit address
  bot.action("get_deposit_address", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;

    try {
      // Derive from your HD wallet logic
      const depositAddress = await getAddressForUser(telegramId);

      // Persist (assumes saveUserWallet can upsert deposit address)
      // Adjust to your actual signature if different:
      // e.g., saveUserWallet(telegramId, withdrawalAddress, depositAddress)
      await saveUserWallet(telegramId, undefined, depositAddress);

      const msg =
        `📥 *Your Deposit Address*\n\`${depositAddress}\`\n\n` +
        `Send *USDT (TRC-20)* or *TRX* here. Credits appear after our watcher confirms the tx.`;

      return ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err) {
      console.error("[DepositAddress] error:", err);
      return ctx.reply("⚠️ Could not generate your deposit address. Please try again.");
    }
  });

  // 📨 Capture pasted withdrawal addresses (only when expected)
  bot.on("text", async (ctx, next) => {
    const telegramId = ctx.from.id;

    if (!waitingForWithdrawAddr.get(telegramId)) {
      return next();
    }

    const addr = (ctx.message?.text || "").trim();

    if (!isValidTronAddress(addr)) {
      return ctx.reply(
        "❌ That doesn’t look like a valid TRON address. It should start with `T`.\nPlease try again or tap /cancel.",
        { parse_mode: "Markdown" }
      );
    }

    try {
      // Persist (assumes saveUserWallet can upsert withdrawal address)
      await saveUserWallet(telegramId, addr, undefined);
      waitingForWithdrawAddr.delete(telegramId);

      return ctx.reply(
        `✅ Withdrawal wallet linked:\n\`${addr}\`\n\nUse /wallet to open the menu.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("[LinkWithdraw] error:", err);
      return ctx.reply("⚠️ Could not save your wallet right now. Please try again.");
    }
  });
}
