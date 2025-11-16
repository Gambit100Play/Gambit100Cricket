// =====================================================
// 💼 WALLET HANDLER — Manage Deposit, Token Balance, Withdraw
// (v4.0 — Redis Rate Limited + Tokens Only + Safe Withdraw Flow)
// =====================================================

import { Markup } from "telegraf";
import { rateLimit } from "../../redis/rateLimit.js";
import { getOrCreateDepositAddress } from "../../utils/generateDepositAddress.js";
import { handleWalletLinkFlow, processWalletAddress } from "./connectWalletHandler.js";
import { logger } from "../../utils/logger.js";
import pkg from "pg";
const { Pool } = pkg;

// Tracks pending withdrawal flows
const pendingWithdrawals = new Map();

// ──────────────────────────────────────────────
// 🗄 PostgreSQL connection
// ──────────────────────────────────────────────
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// ──────────────────────────────────────────────
// 🧩 Wallet Menu UI
// ──────────────────────────────────────────────
function walletMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📥 Deposit Address", "connect_wallet"),
      Markup.button.callback("🔗 Link Withdraw Wallet", "link_withdraw_wallet"),
    ],
    [Markup.button.callback("💰 Check Balance", "check_balance")],
    [Markup.button.callback("💸 Withdraw Funds", "initiate_withdrawal")],
    [Markup.button.callback("🏠 Back to Main Menu", "back_to_main")],
  ]);
}

// ──────────────────────────────────────────────
// 🔎 Fetch deposit address
// ──────────────────────────────────────────────
async function getUserWalletAddress(telegramId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT deposit_address FROM user_wallets WHERE telegram_id = $1 LIMIT 1`,
      [telegramId]
    );
    return res.rows[0]?.deposit_address || null;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────
// 🎛 Main Wallet Handler
// ──────────────────────────────────────────────
export default function walletHandler(bot) {

  // =====================================================
  // 📌 WALLET MENU
  // =====================================================
  bot.action("wallet_menu", async (ctx) => {
    await ctx.answerCbQuery();
    const user = ctx.from.id;

    // ⛔ Rate limit: 3 clicks per 3 sec
    const allowed = await rateLimit(`wallet_menu:${user}`, 3, 3);
    if (!allowed) return ctx.answerCbQuery("⏳ Slow down…");

    const msg =
      `💼 *Your CricPredict Wallet*\n\n` +
      `Manage your in-game funds easily:\n\n` +
      `• 📥 TRC-20 deposit address\n` +
      `• 🔗 Link your TRON withdraw wallet\n` +
      `• 💰 Check G-Tokens balance\n` +
      `• 💸 Withdraw TRX\n\n` +
      `Wallet is linked to your Telegram account.`;

    try {
      await ctx.editMessageText(msg, { parse_mode: "Markdown", ...walletMenu() });
    } catch {
      await ctx.reply(msg, { parse_mode: "Markdown", ...walletMenu() });
    }
  });

  // =====================================================
  // 📥 GENERATE / SHOW DEPOSIT ADDRESS
  // =====================================================
  bot.action("connect_wallet", async (ctx) => {
    await ctx.answerCbQuery();
    const user = ctx.from.id;

    // ⛔ Protect from spam taps
    const allowed = await rateLimit(`deposit_addr:${user}`, 3, 4);
    if (!allowed) return ctx.answerCbQuery("⏳ Please wait…");

    const telegramId = String(ctx.from.id);

    try {
      let address = await getUserWalletAddress(telegramId);
      if (!address) {
        address = await getOrCreateDepositAddress(telegramId);
      }

      await ctx.reply(
        `✅ *Deposit Address Ready!*\n\n` +
          `Send *TRC-20 USDT* to:\n\`${address}\`\n\n` +
          `⚠️ Only TRC-20 USDT supported.\n\n` +
          `🔍 View:\nhttps://shasta.tronscan.org/#/address/${address}`,
        { parse_mode: "Markdown", disable_web_page_preview: true, ...walletMenu() }
      );

    } catch (err) {
      logger.error(err);
      await ctx.reply("⚠️ Could not generate your deposit address. Try again later.", {
        ...walletMenu(),
      });
    }
  });

  // =====================================================
  // 🔗 LINK WITHDRAW WALLET
  // =====================================================
  bot.action("link_withdraw_wallet", async (ctx) => {
    await ctx.answerCbQuery();
    const user = ctx.from.id;

    const allowed = await rateLimit(`link_wallet:${user}`, 3, 4);
    if (!allowed) return ctx.answerCbQuery("⏳ Slow down…");

    await handleWalletLinkFlow(ctx);
  });

  // =====================================================
  // 📝 PROCESS TEXT (Wallet linking OR withdrawal address)
  // =====================================================
  bot.on("text", async (ctx) => {
    const telegramId = String(ctx.from.id);

    // This user is NOT doing withdrawal → treat as linkWallet flow
    if (!pendingWithdrawals.has(telegramId)) {
      return processWalletAddress(ctx, pool);
    }

    // Otherwise this is a withdrawal address submission
    const { trxAmount } = pendingWithdrawals.get(telegramId);
    const addr = ctx.message.text.trim();

    const { tronWeb } = await import("../../wallet/masterWallet.js");
    if (!tronWeb.isAddress(addr)) {
      return ctx.reply("❌ Invalid TRON address. Must start with 'T'.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE balances SET tokens = 0 WHERE telegram_id=$1`,
        [telegramId]
      );

      await client.query(
        `INSERT INTO withdrawals (telegram_id, token, amount, to_address)
         VALUES ($1, 'TRX', $2, $3)`,
        [telegramId, trxAmount, addr]
      );

      await client.query("COMMIT");

      await ctx.reply(
        `✅ Withdrawal request created for *${trxAmount.toFixed(
          2
        )} TRX*.\nFunds will be sent to:\n\`${addr}\``,
        { parse_mode: "Markdown", ...walletMenu() }
      );

    } catch (err) {
      await client.query("ROLLBACK");
      await ctx.reply("⚠️ Withdrawal failed. Try again later.");
    } finally {
      client.release();
      pendingWithdrawals.delete(telegramId);
    }
  });

  // =====================================================
  // 💰 CHECK BALANCE
  // =====================================================
  bot.action("check_balance", async (ctx) => {
    await ctx.answerCbQuery();
    const user = ctx.from.id;

    const allowed = await rateLimit(`check_balance:${user}`, 5, 4);
    if (!allowed) return ctx.answerCbQuery("⏳ Too fast…");

    const telegramId = String(ctx.from.id);
    const client = await pool.connect();

    try {
      const { rows: wRows } = await client.query(
        `SELECT deposit_address, user_wallet_address FROM user_wallets WHERE telegram_id=$1`,
        [telegramId]
      );

      if (!wRows.length) {
        return ctx.reply("❌ No wallet yet. Tap Deposit Address to create one.", {
          parse_mode: "Markdown",
          ...walletMenu(),
        });
      }

      const { deposit_address, user_wallet_address } = wRows[0];

      const { rows: bal } = await client.query(
        `SELECT tokens, bonus_tokens FROM balances WHERE telegram_id=$1`,
        [telegramId]
      );

      const tokens = bal.length ? bal[0].tokens : 0;
      const bonus = bal.length ? bal[0].bonus_tokens : 0;

      await ctx.reply(
        `💰 *Your Token Balance*\n\n` +
          `• 🟠 Tokens: *${tokens}*\n` +
          `• 🎁 Bonus Tokens: *${bonus}*\n\n` +
          `📥 Deposit Address:\n\`${deposit_address}\`\n\n` +
          (user_wallet_address
            ? `🔗 Withdraw Wallet:\n\`${user_wallet_address}\``
            : "🔗 Withdraw wallet not linked yet."),
        { parse_mode: "Markdown", ...walletMenu() }
      );

    } finally {
      client.release();
    }
  });

  // =====================================================
  // 💸 INITIATE WITHDRAWAL
  // =====================================================
  bot.action("initiate_withdrawal", async (ctx) => {
    await ctx.answerCbQuery();
    const user = ctx.from.id;

    const allowed = await rateLimit(`withdraw:${user}`, 3, 4);
    if (!allowed) return ctx.answerCbQuery("⏳ Slow down…");

    const telegramId = String(ctx.from.id);
    const client = await pool.connect();

    try {
      const { rows } = await client.query(
        `SELECT tokens FROM balances WHERE telegram_id=$1`,
        [telegramId]
      );

      if (!rows.length || rows[0].tokens <= 0) {
        return ctx.reply("😕 You have no tokens to withdraw.", {
          ...walletMenu(),
        });
      }

      const tokens = Number(rows[0].tokens);

      const { rows: rateRow } = await client.query(
        `SELECT value FROM settings WHERE key='trx_to_token_rate'`
      );
      const rate = rateRow.length ? Number(rateRow[0].value) : 10;
      const trxAmount = tokens / rate;

      const { rows: minRow } = await client.query(
        `SELECT value FROM settings WHERE key='min_withdraw_trx'`
      );
      const min = minRow.length ? Number(minRow[0].value) : 10;

      if (trxAmount < min) {
        return ctx.reply(
          `⚠️ Minimum withdrawal is ${min} TRX.\nYou have *${trxAmount.toFixed(
            2
          )} TRX* equivalent.`,
          { parse_mode: "Markdown", ...walletMenu() }
        );
      }

      // Set state → next user message = TRON address
      pendingWithdrawals.set(telegramId, { trxAmount });

      await ctx.reply(
        `💰 You can withdraw *${trxAmount.toFixed(
          2
        )} TRX*.\n\nPlease reply with your TRON address (starts with T...).`,
        { parse_mode: "Markdown" }
      );

    } finally {
      client.release();
    }
  });

  // =====================================================
  // 🔙 BACK TO MAIN MENU
  // =====================================================
  bot.action("back_to_main", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.update.message = { text: "/start" };
    await bot.handleUpdate(ctx.update);
  });
}
