// ============================================================
// 💰 CricPredict Wallet Balance Handler
// ============================================================

// 🌐 TronWeb ESM-safe Import (Node v22+ Compatible)
import TronWebModule from "tronweb";
import dotenv from "dotenv";
import { getUserWallet, getUserBalance } from "../../db/db.js";
import { logger } from "../../utils/logger.js";

dotenv.config();

// 🧩 Handle TronWeb export compatibility (v5 → v6)
const TronWeb = TronWebModule.TronWeb || TronWebModule.default || TronWebModule;

// ============================================================
// 🌍 Network Configuration
// ============================================================
const NETWORK = process.env.NETWORK || "mainnet";
const IS_SHASTA = NETWORK.toLowerCase() === "shasta";

const tronWeb = new TronWeb({
  fullHost: IS_SHASTA
    ? "https://api.shasta.trongrid.io"
    : "https://api.trongrid.io",
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
  privateKey: process.env.TRON_PRIVATE_KEY || "",
});

logger.info(`🌍 [WalletHandler] Tron network: ${IS_SHASTA ? "Shasta Testnet" : "Mainnet"}`);

// ============================================================
// 🔠 MarkdownV2 Escape Utility
// ============================================================
function escapeMdV2(text = "") {
  try {
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
  } catch {
    return text;
  }
}

// ============================================================
// 📊 Named Export — Show Balance (Reusable Function)
// ============================================================
export async function showBalance(ctx) {
  const userId = ctx.from?.id;
  logger.info(`💰 [ShowBalance] Triggered by Telegram user=${userId}`);

  try {
    await ctx.answerCbQuery?.("📊 Fetching wallet balance...");

    // 1️⃣ Fetch wallet info from DB
    const userWallet = await getUserWallet(userId);
    if (!userWallet?.deposit_address) {
      logger.warn(`⚠️ [ShowBalance] No wallet linked for user=${userId}`);
      return ctx.reply(
        "⚠️ You haven’t connected a deposit wallet yet\\. Please link your TRON address first\\.",
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔗 Connect Wallet", callback_data: "connect_wallet" },
                { text: "🏠 Main Menu", callback_data: "main_menu" },
              ],
            ],
          },
        }
      );
    }

    const depositAddress = userWallet.deposit_address;
    logger.info(`🔗 [ShowBalance] Checking on-chain balances for ${depositAddress}`);

    // 2️⃣ Fetch TRX + USDT on-chain balances
    const balanceInSun = await tronWeb.trx.getBalance(depositAddress);
    const trxBalance = Number(tronWeb.fromSun(balanceInSun));

    let usdtBalance = 0;
    try {
      const usdtContract =
        process.env.USDT_CONTRACT_ADDRESS ||
        "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"; // default: Mainnet
      const contract = await tronWeb.contract().at(usdtContract);
      const bal = await contract.balanceOf(depositAddress).call();
      usdtBalance = Number(tronWeb.fromSun(bal));
    } catch (err) {
      logger.warn(`⚠️ [ShowBalance] Skipped USDT fetch: ${err.message}`);
    }

    // 3️⃣ Fetch G-Token balance from DB
    const tokenBal = await getUserBalance(userId);
    if (!tokenBal) {
      logger.warn(`⚠️ [ShowBalance] No token balance found in DB for user=${userId}`);
    }

    // 4️⃣ Construct MarkdownV2 message
    const msg =
      `💼 *CricPredict Wallet Summary*\\n\\n` +
      `📥 *Deposit Address:*\\n\`${escapeMdV2(depositAddress)}\`\\n\\n` +
      `🌐 *Network:* ${IS_SHASTA ? "Shasta Testnet" : "TRON Mainnet"}\\n\\n` +
      `💎 *On\\-Chain Balances:*\\n` +
      `• TRX: ${trxBalance.toFixed(3)}\\n` +
      `• USDT: ${usdtBalance.toFixed(3)}\\n\\n` +
      `🎯 *In\\-App G\\-Token Balance:*\\n` +
      `• Tokens: ${tokenBal?.tokens?.toFixed(2) || 0}\\n` +
      `• Bonus Tokens: ${tokenBal?.bonus_tokens?.toFixed(2) || 0}\\n` +
      `• USDT Equivalent: ${tokenBal?.usdt?.toFixed(2) || 0}\\n\\n` +
      `💡 *Conversion:* 1 G\\-Token = 1 USDT`;

    await ctx.reply(msg, {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🪙 Get G Tokens", callback_data: "get_g_tokens" },
            { text: "🏠 Main Menu", callback_data: "main_menu" },
          ],
        ],
      },
    });

    logger.info(`✅ [ShowBalance] Wallet info sent to user=${userId}`);
  } catch (err) {
    logger.error(`💥 [ShowBalance] Error for user=${userId}: ${err.message}`);
    try {
      await ctx.reply("⚠️ Unable to fetch wallet details\\. Please try again shortly\\.", {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]],
        },
      });
    } catch (replyErr) {
      logger.error(`⚠️ [ShowBalance] Secondary reply failed: ${replyErr.message}`);
    }
  }
}

// ============================================================
// 🧩 Default Export — Handler Registration
// ============================================================
export default function checkBalanceHandler(bot) {
  // Attach the callable balance function for reuse in betHandler etc.
  bot.checkBalance = async (ctx) => {
    await showBalance(ctx);
  };

  // Inline Button Handler
  bot.action("check_balance", async (ctx) => {
    const userId = ctx.from?.id;
    logger.info(`💰 [CheckBalance] Inline button clicked by user=${userId}`);
    await bot.checkBalance(ctx);
  });
}
