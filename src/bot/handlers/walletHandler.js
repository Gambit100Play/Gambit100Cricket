import { Markup } from "telegraf";
import fetch from "node-fetch";
import { saveUserWallet, getUserWallet } from "../../db/db.js";

const API_KEY = process.env.CRYPTO_API_KEY;
const WALLET_ID = process.env.CRYPTO_WALLET_ID;

/**
 * 🔧 Helper — Derive a TRON deposit address from Crypto APIs WaaS
 */
async function createDepositAddress(walletId, index) {
  const url = `https://rest.cryptoapis.io/v2/wallet-as-a-service/wallets/${walletId}/tron/addresses/derive`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify({
      context: "telegram_user",
      data: { item: { index } },
    }),
  });

  const data = await res.json();
  if (!data?.data?.item?.address) {
    throw new Error("Deposit address not returned: " + JSON.stringify(data));
  }
  return data.data.item.address;
}

/**
 * 🧩 Wallet Menu UI
 */
function walletMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔗 Connect Wallet", "connect_wallet")],
    [Markup.button.callback("💰 Check Balance", "check_balance")],
    [Markup.button.callback("🏠 Back to Main Menu", "back_to_main")],
  ]);
}

export default function walletHandler(bot) {
  /**
   * 💼 Wallet Menu
   */
  bot.action("wallet_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `💼 *Your CricPredict Wallet*\n\n` +
        `Manage everything related to your in-game funds:\n\n` +
        `• 🔗 Connect your TRC-20 wallet (for deposits & withdrawals)\n` +
        `• 💰 Check your G-Tokens, Bonus Tokens, and USDT balance\n` +
        `• 🪙 Use tokens to participate in prediction pools\n\n` +
        `Your wallet is securely linked to your Telegram account.`,
      { parse_mode: "Markdown", ...walletMenu() }
    );
  });

  /**
   * 🔗 Connect Wallet
   */
  bot.action("connect_wallet", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from.id);

    try {
      let address = await getUserWallet(telegramId);
      if (!address) {
        address = await createDepositAddress(WALLET_ID, telegramId);
        await saveUserWallet(telegramId, address);
      }

      await ctx.reply(
        `✅ *Wallet Connected!*\n\n` +
          `Here’s your deposit address for *TRC-20 USDT*:\n\n` +
          `\`${address}\`\n\n` +
          `⚠️ *Important:* Only send TRC-20 USDT to this address. ` +
          `Using other tokens or networks may result in permanent loss.`,
        { parse_mode: "Markdown", ...walletMenu() }
      );
    } catch (err) {
      console.error("Wallet connect error:", err);
      await ctx.reply("❌ Failed to connect wallet. Please try again later.", {
        parse_mode: "Markdown",
        ...walletMenu(),
      });
    }
  });

  /**
   * 💰 Check Balance
   */
  bot.action("check_balance", async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = String(ctx.from.id);

    try {
      const walletAddress = await getUserWallet(telegramId);
      if (!walletAddress) {
        return ctx.reply(
          "❌ No wallet connected yet. Tap *Connect Wallet* below to create one.",
          { parse_mode: "Markdown", ...walletMenu() }
        );
      }

      await ctx.reply(
        `💰 *Your Wallet Overview*\n\n` +
          `Wallet: \`${walletAddress}\`\n\n` +
          `Balances:\n` +
          `• 🎟️ G-Tokens: used for predictions\n` +
          `• 🎁 Bonus Tokens: free tokens (non-withdrawable)\n` +
          `• 💵 USDT (TRC-20): available for deposit & withdrawal\n\n` +
          `All balances auto-update after each match or transaction.`,
        { parse_mode: "Markdown", ...walletMenu() }
      );
    } catch (err) {
      console.error("Balance fetch error:", err);
      await ctx.reply("⚠️ Unable to fetch wallet balance right now.", {
        parse_mode: "Markdown",
        ...walletMenu(),
      });
    }
  });

  /**
   * 🔙 Back to Main Menu
   * Delegates to /start in startHandler (single source of truth)
   */
  bot.action("back_to_main", async (ctx) => {
    await ctx.answerCbQuery();
    // Simulate a /start command to reuse startHandler logic
    ctx.update.message = { text: "/start" }; // mimic a start command
    await bot.handleUpdate(ctx.update); // let Telegraf route it to bot.start()
  });
}
