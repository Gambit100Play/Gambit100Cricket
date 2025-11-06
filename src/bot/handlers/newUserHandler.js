// =====================================================
// 🧠 NEW USER HANDLER — Auto Registration + Deposit Wallet Creation
// =====================================================
import {
  createOrUpdateUser,
  getUserById,
  updateUserActivity,
  query,
} from "../../db/db.js";
import { logger } from "../../utils/logger.js";
import { getOrCreateDepositAddress } from "../../utils/generateDepositAddress.js";

export default function newUserHandler(bot) {
  bot.use(async (ctx, next) => {
    try {
      const telegramId = ctx.from?.id;
      if (!telegramId) return next();

      // 1️⃣ Create user if missing, else update activity
      const user = await getUserById(telegramId);
      if (!user) {
        await createOrUpdateUser(
          telegramId,
          ctx.from?.username || null,
          ctx.from?.first_name || "",
          ctx.from?.last_name || ""
        );
        logger.info(
          `👋 [NewUser] Registered new user ${telegramId} (${ctx.from?.username || "no username"})`
        );
      } else {
        await updateUserActivity(telegramId);
      }

      // 2️⃣ Ensure a deposit wallet exists
      const walletInfo = await getOrCreateDepositAddress(telegramId);

      // Defensive normalization for weird data (old JSON strings)
      let address = walletInfo?.address;
      if (typeof address !== "string") {
        try {
          const parsed = JSON.parse(address);
          if (parsed?.address) address = parsed.address;
        } catch {
          // ignore parse errors; leave as-is
        }
      }

      const derivationIndex = walletInfo?.derivationIndex;
      if (!address || typeof address !== "string" || !address.startsWith("T")) {
        throw new Error(`Invalid TRON address structure for user ${telegramId}: ${address}`);
      }

      // 3️⃣ Mirror the address into `users` (no redundant wallet insert)
      await query(
        `UPDATE users
           SET deposit_address = $1,
               last_active = NOW()
         WHERE telegram_id = $2
           AND (deposit_address IS NULL OR deposit_address != $1)`,
        [address, telegramId]
      );

      logger.info(
        `💰 [NewUser] Deposit address ensured for ${telegramId}: ${address} (index=${derivationIndex})`
      );

      await next();
    } catch (err) {
      logger.error(`❌ [NewUserHandler] ${err.message}`);
      await next();
    }
  });
}
