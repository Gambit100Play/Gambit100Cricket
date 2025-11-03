import { Markup } from "telegraf";
import { getOrCreateDepositAddress } from "./generateDepositAddress.js";
import { logger } from "../../utils/logger.js";
import pkg from "pg";
const { Pool } = pkg;

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
      Markup.button.callback("📥 Generate Deposit Address", "connect_wallet"),
      Markup.button.callback("🔗 Connect Your Own Wallet", "link_withdraw_wallet"),
    ],
    [Markup.button.callback("💰 Check Balance", "check_balance")],
    [Markup.button.callback("🏠 Back to Main Menu", "back_to_main")],
  ]);
}

// ──────────────────────────────────────────────
// 🧭 Helper — get deposit address from DB
// ──────────────────────────────────────────────
async function getUserWalletAddress(telegramId) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT deposit_address FROM user_wallets WHERE telegram_id = $1 LIMIT 1`,
      [telegramId]
    );
    return res.rows[0]?.deposit_address || null;
  } catch (err) {
    logger.error(`❌ [WalletHandler] DB fetch error for ${telegramId}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────
// 🎛 Main Wallet Handler
// ──────────────────────────────────────────────
export default function walletHandler(bot) {
  // 💼 Wallet Menu
  bot.action("wallet_menu", async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(
        `💼 *Your CricPredict Wallet*\n\n` +
          `Manage your in-game funds easily:\n\n` +
          `• 📥 Generate or check your TRC-20 deposit address\n` +
          `• 🔗 Connect your own TRON wallet for withdrawals\n` +
          `• 💰 Check your G-Tokens and USDT balance\n\n` +
          `Your wallet is securely linked to your Telegram account.`,
        { parse_mode: "Markdown", ...walletMenu() }
      );
    } catch {
      await ctx.reply(
        `💼 *Your CricPredict Wallet*\n\n` +
          `Manage your in-game funds easily:\n\n` +
          `• 📥 Generate or check your TRC-20 deposit address\n` +
          `• 🔗 Connect your own TRON wallet for withdrawals\n` +
          `• 💰 Check your G-Tokens and USDT balance\n\n` +
          `Your wallet is securely linked to your Telegram account.`,
        { parse_mode: "Markdown", ...walletMenu() }
      );
    }
  });

  // 📥 Generate Deposit Wallet
  bot.action("connect_wallet", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from.id);
    logger.info(`🪙 [WalletHandler] connect_wallet triggered for ${telegramId}`);

    try {
      let address = await getUserWalletAddress(telegramId);
      if (!address) {
        address = await getOrCreateDepositAddress(telegramId);
        if (!address) throw new Error("Failed to derive deposit address");
      }

      await ctx.reply(
        `✅ *Wallet Connected!*\n\n` +
          `Here’s your deposit address for *TRC-20 USDT*:\n\n` +
          `\`${address}\`\n\n` +
          `⚠️ *Only send TRC-20 USDT to this address.*\n` +
          `Using other tokens or networks may result in permanent loss.\n\n` +
          `🔍 [View on Tronscan](https://shasta.tronscan.org/#/address/${address})`,
        { parse_mode: "Markdown", disable_web_page_preview: true, ...walletMenu() }
      );
    } catch (err) {
      logger.error(`❌ [WalletHandler] Wallet connection failed for ${telegramId}: ${err.message}`);
      await ctx.reply("⚠️ Could not generate your deposit address. Please try again later.", {
        parse_mode: "Markdown",
        ...walletMenu(),
      });
    }
  });

  // 🔗 Connect Own Wallet — now session-based and reliable
  bot.action("link_withdraw_wallet", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    logger.info(`🔗 [WalletHandler] connect your own wallet triggered for ${telegramId}`);

    // mark in session that we expect the next message to be a wallet address
    ctx.session.awaitingWalletAddress = true;

    await ctx.reply(
      "🔗 *Please send me your TRON wallet address* (must start with `T`).\n\n" +
        "Example: `TDQuVs7y1wckGmXBssjFvFkoui18qj2RmB`\n\n" +
        "Once sent, it’ll be linked to your account for withdrawals.",
      { parse_mode: "Markdown" }
    );
  });

  // 🧩 Handle text input for wallet linking
  bot.on("text", async (ctx) => {
    if (!ctx.session?.awaitingWalletAddress) return; // ignore if not expecting address

    const telegramId = String(ctx.from.id);
    const walletAddr = ctx.message.text.trim();
    ctx.session.awaitingWalletAddress = false; // reset state

    if (!/^T[a-zA-Z0-9]{33}$/.test(walletAddr)) {
      await ctx.reply("⚠️ Invalid TRON address format. Please try again.", {
        parse_mode: "Markdown",
        ...walletMenu(),
      });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE user_wallets
         SET user_wallet_address = $1
         WHERE telegram_id = $2`,
        [walletAddr, telegramId]
      );

      await ctx.reply(
        `✅ *Wallet Linked Successfully!*\n\n` +
          `Your withdrawal wallet:\n\`${walletAddr}\`\n\n` +
          `You can change it anytime by tapping *Connect Your Own Wallet* again.`,
        { parse_mode: "Markdown", ...walletMenu() }
      );

      logger.info(`✅ [WalletHandler] Linked wallet for ${telegramId}: ${walletAddr}`);
    } catch (err) {
      logger.error(`⚠️ [WalletHandler] Wallet linking failed for ${telegramId}: ${err.message}`);
      await ctx.reply("⚠️ Could not save your wallet. Try again later.", {
        parse_mode: "Markdown",
        ...walletMenu(),
      });
    } finally {
      client.release();
    }
  });

  // 💰 Check Balance
  bot.action("check_balance", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from.id);
    logger.info(`💰 [WalletHandler] check_balance triggered for ${telegramId}`);

    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT deposit_address, last_balance_trx, last_balance_usdt, user_wallet_address
           FROM user_wallets
          WHERE telegram_id = $1
          LIMIT 1`,
        [telegramId]
      );

      if (!res.rows.length) {
        await ctx.reply(
          "❌ No wallet found yet. Tap *Generate Deposit Address* below to create one.",
          { parse_mode: "Markdown", ...walletMenu() }
        );
        return;
      }

      const { deposit_address, last_balance_trx, last_balance_usdt, user_wallet_address } =
        res.rows[0];

      await ctx.reply(
        `💰 *Your Wallet Overview*\n\n` +
          `Deposit Address: \`${deposit_address}\`\n` +
          (user_wallet_address ? `Linked Wallet: \`${user_wallet_address}\`\n\n` : "\n") +
          `Balances:\n` +
          `• ⚡ TRX: \`${last_balance_trx || 0}\`\n` +
          `• 💵 USDT (TRC-20): \`${last_balance_usdt || 0}\`\n\n` +
          `Balances auto-refresh after every detected on-chain deposit.`,
        { parse_mode: "Markdown", ...walletMenu() }
      );

      logger.info(
        `📊 [WalletHandler] Displayed wallet for ${telegramId}: TRX=${last_balance_trx}, USDT=${last_balance_usdt}`
      );
    } catch (err) {
      logger.error(`⚠️ [WalletHandler] Balance fetch failed for ${telegramId}: ${err.message}`);
      await ctx.reply("⚠️ Unable to fetch wallet balance right now.", {
        parse_mode: "Markdown",
        ...walletMenu(),
      });
    } finally {
      client.release();
    }
  });

  // 🔙 Back to Main Menu
  bot.action("back_to_main", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.update.message = { text: "/start" };
    await bot.handleUpdate(ctx.update);
  });
}
