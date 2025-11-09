// =====================================================
// 🧠 NEW USER HANDLER — Auto Registration + Deposit Wallet Creation (v4.1 FINAL — Markdown-Stable)
// =====================================================
import {
  createOrUpdateUser,
  getUserById,
  updateUserActivity,
  query,
} from "../../db/db.js";
import { logger } from "../../utils/logger.js";
import { getOrCreateDepositAddress } from "../../utils/generateDepositAddress.js";
import { safeMarkdown } from "../../utils/markdown.js";

// 🧩 In-memory cooldown to prevent spammy DB writes
const recentActivityCache = new Map(); // telegramId → timestamp

export default function newUserHandler(bot) {
  bot.use(async (ctx, next) => {
    try {
      if (!ctx?.from?.id) return await next();
      const telegramId = ctx.from.id;

      // =====================================================
      // 🧰 Safe Markdown Wrapper (prevents double escaping)
      // =====================================================
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
            logger.warn(
              "⚠️ [SafeReply] Telegram Markdown parse error suppressed (fallback to plain text)."
            );
            return await originalReply(String(text), { parse_mode: undefined });
          }
          throw err;
        }
      };

      const originalEdit = ctx.editMessageText?.bind(ctx);
      ctx.editMessageText = async (text, opts = {}) => {
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

          return await originalEdit(text, opts);
        } catch (err) {
          if (err.message?.includes("can't parse entities")) {
            logger.warn(
              "⚠️ [SafeEdit] Telegram Markdown parse error suppressed (fallback to plain text)."
            );
            return await originalEdit(String(text), { parse_mode: undefined });
          }
          throw err;
        }
      };

      // =====================================================
      // 🕒 30-second cooldown to avoid redundant DB writes
      // =====================================================
      const now = Date.now();
      const lastSeen = recentActivityCache.get(telegramId);
      if (lastSeen && now - lastSeen < 30_000) return await next();
      recentActivityCache.set(telegramId, now);

      // =====================================================
      // 1️⃣ Register or update user
      // =====================================================
      let user = await getUserById(telegramId);

      if (!user) {
        await createOrUpdateUser(
          telegramId,
          ctx.from.username || null,
          ctx.from.first_name || "",
          ctx.from.last_name || ""
        );
        logger.info(`👋 [NewUser] Registered new user ${telegramId}`);
      } else {
        await updateUserActivity(telegramId);
      }

      // =====================================================
      // 2️⃣ Ensure TRON deposit wallet exists
      // =====================================================
      const walletInfo = await getOrCreateDepositAddress(telegramId);
      let address = walletInfo?.address;
      const derivationIndex = walletInfo?.derivationIndex ?? "?";

      if (address && typeof address !== "string") {
        try {
          const parsed = JSON.parse(address);
          if (parsed?.address) address = parsed.address;
        } catch {
          /* ignore malformed JSON */
        }
      }

      if (!address || !address.startsWith("T")) {
        throw new Error(`Invalid or missing TRON address for user ${telegramId}`);
      }

      // Update only if changed
      await query(
        `UPDATE users
           SET deposit_address = $1,
               last_active = NOW()
         WHERE telegram_id = $2
           AND (deposit_address IS NULL OR deposit_address != $1)`,
        [address, telegramId]
      );

      // =====================================================
      // 3️⃣ Notify new user (HTML-safe)
      // =====================================================
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

      // =====================================================
      // 4️⃣ Continue downstream safely
      // =====================================================
      try {
        await next();
      } catch (innerErr) {
        if (innerErr.message?.includes("can't parse entities")) {
          logger.warn(
            "⚠️ [NewUserHandler] Ignored downstream Markdown parse warning (safe)."
          );
          return;
        }
        logger.warn(
          `⚠️ [NewUserHandler] Downstream handler error ignored: ${innerErr.message}`
        );
      }

    } catch (err) {
      // =====================================================
      // ❌ Wallet or DB failure
      // =====================================================
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
