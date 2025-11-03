// src/bot/handlers/connectWalletHandler.js
import * as TronWebNS from "tronweb";
import dotenv from "dotenv";
import pkg from "pg";
import { getAddressForUser } from "../../utils/wallet.js";
import { logger } from "../../utils/logger.js";

dotenv.config();
const { Pool } = pkg;

// ────────────────────────────────────────────────
// 🗄 PostgreSQL connection pool
// ────────────────────────────────────────────────
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// ────────────────────────────────────────────────
// 🌐 Tron setup (v5/v6 safe)
// ────────────────────────────────────────────────
const TronWeb = TronWebNS.TronWeb ?? TronWebNS.default ?? TronWebNS;
if (typeof TronWeb !== "function") {
  console.error("[tronweb] export keys:", Object.keys(TronWebNS || {}));
  throw new Error("Invalid tronweb import — check version consistency.");
}

const NETWORK = (process.env.NETWORK || "mainnet").toLowerCase();
const IS_SHASTA = NETWORK === "shasta";
const tronWeb = new TronWeb({
  fullHost: IS_SHASTA ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io",
  headers: process.env.TRONGRID_API_KEY
    ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
    : undefined,
});

// ────────────────────────────────────────────────
// 🔎 Address Validation Helper
// ────────────────────────────────────────────────
function isValidTronAddress(addr) {
  try {
    return !!addr && tronWeb.isAddress(addr);
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────
// 🧩 Database Helpers
// ────────────────────────────────────────────────
async function getUserWallet(telegramId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT deposit_address, last_balance_trx, last_balance_usdt
         FROM user_wallets
        WHERE telegram_id = $1
        LIMIT 1`,
      [telegramId]
    );
    return res.rows[0] || {};
  } catch (err) {
    logger.error(`❌ [connectWalletHandler] DB fetch error for ${telegramId}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

async function upsertUserWallet(telegramId, deposit_address) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_wallets (telegram_id, deposit_address)
       VALUES ($1, $2)
       ON CONFLICT (telegram_id)
       DO UPDATE SET deposit_address = EXCLUDED.deposit_address`,
      [telegramId, deposit_address]
    );
    logger.info(
      `✅ [connectWalletHandler] Wallet upsert complete for ${telegramId} — ${deposit_address}`
    );
  } catch (err) {
    logger.error(`❌ [connectWalletHandler] Upsert failed for ${telegramId}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

// ────────────────────────────────────────────────
// 🧭 Main Handler (NO UI CONFLICTS NOW)
// ────────────────────────────────────────────────
export default function connectWalletHandler(bot) {
  // ⚙️ Generate / Retrieve Deposit Address (called from walletHandler)
  bot.action("get_deposit_address", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from.id);
    logger.info(`📥 [connectWalletHandler] get_deposit_address triggered by ${telegramId}`);

    try {
      let { deposit_address } = await getUserWallet(telegramId);

      if (!deposit_address) {
        deposit_address = await getAddressForUser(telegramId);
        await upsertUserWallet(telegramId, deposit_address);
        logger.info(`✅ [connectWalletHandler] Generated new deposit for ${telegramId}`);
      }

      await ctx.reply(
        `📮 *Your Deposit Address*:\n\`${deposit_address}\`\n\n` +
          `Network: *${IS_SHASTA ? "Shasta Testnet" : "TRON Mainnet"}*\n\n` +
          `Use this to deposit *USDT (TRC-20)* or *TRX* for predictions.\n\n` +
          `🔍 [View on Tronscan](https://${
            IS_SHASTA ? "shasta" : "tronscan"
          }.org/#/address/${deposit_address})`,
        { parse_mode: "Markdown", disable_web_page_preview: true }
      );
    } catch (err) {
      logger.error(
        `❌ [connectWalletHandler] Deposit address fetch failed for ${telegramId}: ${err.message}`
      );
      await ctx.reply("⚠️ Could not generate your deposit address. Please try again later.");
    }
  });

  // 💰 Check Balance (still useful for balance button)
  bot.action("check_balance", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from.id);
    logger.info(`💰 [connectWalletHandler] check_balance triggered for ${telegramId}`);

    try {
      const wallet = await getUserWallet(telegramId);
      if (!wallet.deposit_address) {
        return ctx.reply(
          "❌ No wallet found yet. Tap *Generate Deposit Address* to create one.",
          { parse_mode: "Markdown" }
        );
      }

      const { deposit_address, last_balance_trx, last_balance_usdt } = wallet;

      await ctx.reply(
        `💰 *Your Wallet Overview*\n\n` +
          `Address: \`${deposit_address}\`\n\n` +
          `• ⚡ TRX: \`${last_balance_trx || 0}\`\n` +
          `• 💵 USDT (TRC-20): \`${last_balance_usdt || 0}\`\n\n` +
          `Balances auto-update after each on-chain confirmation.`,
        { parse_mode: "Markdown" }
      );

      logger.info(
        `📊 [connectWalletHandler] Displayed wallet for ${telegramId}: TRX=${last_balance_trx}, USDT=${last_balance_usdt}`
      );
    } catch (err) {
      logger.error(`❌ [connectWalletHandler] Balance fetch failed: ${err.message}`);
      await ctx.reply("⚠️ Unable to fetch wallet balance right now.");
    }
  });
}
