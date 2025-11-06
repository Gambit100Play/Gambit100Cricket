// src/bot/handlers/connectWalletHandler.js
import { logger } from "../../utils/logger.js";

/**
 * 🔗 Prompt user to link their TRON wallet.
 */
export async function handleWalletLinkFlow(ctx) {
  const telegramId = ctx.from.id;
  logger.info(`🔗 [connectWalletHandler] Linking wallet flow started for ${telegramId}`);

  ctx.session.awaitingWalletAddress = true;

  await ctx.reply(
    "🔗 *Please send your TRON wallet address* (must start with `T`).\n\n" +
      "Example: `TDQuVs7y1wckGmXBssjFvFkoui18qj2RmB`\n\n" +
      "Once sent, it’ll be linked to your account for withdrawals.",
    { parse_mode: "Markdown" }
  );
}

/**
 * 🏦 Process and store the user's wallet address in PostgreSQL.
 */
export async function processWalletAddress(ctx, pool) {
  if (!ctx.session?.awaitingWalletAddress) return;

  const telegramId = String(ctx.from.id);
  const walletAddr = ctx.message.text.trim();
  ctx.session.awaitingWalletAddress = false;

  // ✅ Validate TRON address format
  if (!/^T[a-zA-Z0-9]{33}$/.test(walletAddr)) {
    await ctx.reply("⚠️ Invalid TRON address format. Please try again.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE user_wallets 
         SET user_wallet_address = $1, updated_at = NOW()
       WHERE telegram_id = $2`,
      [walletAddr, telegramId]
    );

    await ctx.reply(
      `✅ *Wallet Linked Successfully!*\n\n` +
        `Your withdrawal wallet:\n\`${walletAddr}\`\n\n` +
        `You can change it anytime by tapping *Connect Your Own Wallet* again.`,
      { parse_mode: "Markdown" }
    );

    logger.info(`✅ [connectWalletHandler] Linked wallet for ${telegramId}: ${walletAddr}`);
  } catch (err) {
    logger.error(`⚠️ [connectWalletHandler] DB update failed: ${err.message}`);
    await ctx.reply("⚠️ Could not save your wallet. Try again later.");
  } finally {
    client.release();
  }
}
