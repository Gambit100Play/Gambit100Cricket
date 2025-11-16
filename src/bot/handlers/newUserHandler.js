// =====================================================
// 🧠 NEW USER HANDLER — Auto Registration + HD Deposit Wallet Creation
// (v6.1 — Deterministic, Unique Index via wallet_sequence, Markdown-Safe)
// =====================================================
import {
  createOrUpdateUser,
  getUserById,
  updateUserActivity,
  query,
} from "../../db/db.js";
import { logger } from "../../utils/logger.js";
import { safeMarkdown } from "../../utils/markdown.js";
import {
  initMasterWallet,
  deriveDepositAddress,
} from "../../wallet/masterWallet.js";

const recentActivityCache = new Map(); // telegramId → timestamp
let walletInitialized = false;

export default function newUserHandler(bot) {
  bot.use(async (ctx, next) => {
    try {
      if (!ctx?.from?.id) return await next();
      const telegramId = ctx.from.id;

      // ──────────────────────────────────────────────
      // 🧰 Safe Markdown Wrapper
      // ──────────────────────────────────────────────
      const originalReply = ctx.reply.bind(ctx);
      ctx.reply = async (text, opts = {}) => {
        try {
          const isMarkdown = opts?.parse_mode === "MarkdownV2";
          const alreadyEscaped =
            typeof text === "string" &&
            (text.includes("\\_") ||
              text.includes("\\-") ||
              text.includes("\\(") ||
              text.includes("\\*") ||
              text.includes("\\[") ||
              text.includes("\\]") ||
              opts.__escaped);
          if (isMarkdown && typeof text === "string" && !alreadyEscaped) {
            text = safeMarkdown(text);
          }
          return await originalReply(text, opts);
        } catch (err) {
          if (err.message?.includes("can't parse entities")) {
            logger.warn("⚠️ [SafeReply] Markdown parse error suppressed.");
            return await originalReply(String(text), { parse_mode: undefined });
          }
          throw err;
        }
      };

      // ──────────────────────────────────────────────
      // 🕒 Cooldown (30 s) to avoid redundant writes
      // ──────────────────────────────────────────────
      const now = Date.now();
      const lastSeen = recentActivityCache.get(telegramId);
      if (lastSeen && now - lastSeen < 30_000) return await next();
      recentActivityCache.set(telegramId, now);

      // ──────────────────────────────────────────────
      // 👤 1️⃣ Register or update user
      // ──────────────────────────────────────────────
      let user = await getUserById(telegramId);
      if (!user) {
        await createOrUpdateUser(
          telegramId,
          ctx.from.username || null,
          ctx.from.first_name || "",
          ctx.from.last_name || ""
        );
        logger.info(`👋 [NewUser] Registered new user ${telegramId}`);
        user = await getUserById(telegramId);
      } else {
        await updateUserActivity(telegramId);
      }

      // ──────────────────────────────────────────────
      // 🔑 2️⃣ Ensure master wallet initialized once
      // ──────────────────────────────────────────────
      if (!walletInitialized) {
        await initMasterWallet({ generateIfMissing: true });
        walletInitialized = true;
        logger.info("🔑 [MasterWallet] Initialized successfully (cached).");
      }

      // ──────────────────────────────────────────────
      // 💎 3️⃣ Determine or allocate unique derivation index
      // ──────────────────────────────────────────────
      let derivationIndex = user?.derivation_index;
      if (derivationIndex === null || derivationIndex === undefined) {
        // create sequence table if it doesn't exist
        await query(`
          CREATE TABLE IF NOT EXISTS wallet_sequence (
            id SERIAL PRIMARY KEY
          );
        `);

        const { rows } = await query(`
          INSERT INTO wallet_sequence DEFAULT VALUES
          RETURNING id AS next_index;
        `);
        derivationIndex = rows[0].next_index;
      }

      // ──────────────────────────────────────────────
      // 💰 4️⃣ Derive deterministic deposit address
      // ──────────────────────────────────────────────
      const { address } = deriveDepositAddress(derivationIndex);
      if (!address || !address.startsWith("T")) {
        throw new Error(`Invalid TRON address derived for user ${telegramId}`);
      }

      // ──────────────────────────────────────────────
      // 🗄️ 5️⃣ Save deposit info (no private key)
      // ──────────────────────────────────────────────
      await query(
        `UPDATE users
           SET deposit_address = $1,
               derivation_index = $2,
               last_active = NOW()
         WHERE telegram_id = $3`,
        [address, derivationIndex, telegramId]
      );

      // ──────────────────────────────────────────────
      // 📩 6️⃣ Notify user (first-time setup)
      // ──────────────────────────────────────────────
      if (!user?.deposit_address) {
        try {
          await ctx.reply(
            `💰 Deposit wallet ready!\n<b>Address:</b> <code>${address}</code>\n<b>Index:</b> ${derivationIndex}`,
            { parse_mode: "HTML" }
          );
        } catch (sendErr) {
          logger.warn(
            `⚠️ [NewUserHandler] Could not send wallet message: ${sendErr.message}`
          );
        }
      }

      logger.info(
        `💰 [NewUser] Deposit ensured for ${telegramId}: ${address} [index=${derivationIndex}]`
      );

      // ──────────────────────────────────────────────
      // 🚦 7️⃣ Continue downstream safely
      // ──────────────────────────────────────────────
      await next();
    } catch (err) {
      logger.error(`❌ [NewUserHandler] ${err.stack || err.message}`);
      try {
        await ctx.reply(
          safeMarkdown(
            "⚠️ A temporary issue occurred while setting up your wallet.\nYou can still browse matches — please retry later."
          ),
          { parse_mode: "MarkdownV2", __escaped: true }
        );
      } catch (sendErr) {
        logger.warn(
          `⚠️ [NewUserHandler] Failed to notify user: ${sendErr.message}`
        );
      }
    }
  });
}
