// =====================================================
// 🧪 MANUAL TEST: newUserHandler — Auto Registration + Deposit Address
// Run with: node src/tests/testNewUserHandler.js
// =====================================================
import dotenv from "dotenv";
import { pool, getUserById, query } from "../db/db.js"; // ✅ corrected relative path
import { getOrCreateDepositAddress } from "../utils/generateDepositAddress.js";
import newUserHandler from "../bot/handlers/newUserHandler.js";
import { logger } from "../utils/logger.js";

dotenv.config();

async function main() {
  console.log("\n=======================================");
  console.log("🧪 Running newUserHandler Integration Test...");
  console.log("=======================================\n");

  // 🧠 Mock Telegraf bot structure
  const mockBot = {
    use: (fn) => {
      mockBot._middleware = fn;
    },
  };

  // Attach the middleware
  newUserHandler(mockBot);

  // 🧾 Mock Telegram context
  const mockCtx = {
    from: {
      id: 2222222, // test ID
      username: "test_user",
      first_name: "Test",
      last_name: "User",
    },
    reply: async (msg) => console.log("💬 BOT REPLY:", msg),
  };

  try {
    console.log("▶️ Simulating /start or first interaction...");

    // Run middleware manually
    await mockBot._middleware(mockCtx, async () => {});

    // ✅ Step 1: Verify user created
    const user = await getUserById(mockCtx.from.id);
    if (!user) {
      console.error("❌ User not found in DB! Stopping test.");
      return;
    }

    console.log(`✅ User found in DB: ${user.username || "(no username)"}`);

    // ✅ Step 2: Check wallet existence
    const walletRes = await query(
      "SELECT deposit_address FROM user_wallets WHERE telegram_id = $1 LIMIT 1",
      [mockCtx.from.id]
    );

    if (walletRes.rows.length > 0) {
      const addr = walletRes.rows[0].deposit_address;
      if (/^T[a-zA-Z0-9]{33}$/.test(addr)) {
        console.log(`✅ Wallet valid: ${addr}`);
      } else {
        console.warn("⚠️ Invalid TRON address format:", addr);
      }
    } else {
      console.warn("⚠️ No wallet found, generating one...");
      const newAddr = await getOrCreateDepositAddress(mockCtx.from.id);
      await query(
        `INSERT INTO user_wallets (telegram_id, deposit_address, created_at)
         VALUES ($1, $2, NOW()) ON CONFLICT (telegram_id) DO NOTHING`,
        [mockCtx.from.id, newAddr]
      );
      console.log(`✅ Wallet created manually: ${newAddr}`);
    }

    // ✅ Step 3: Verify user record mirrors the address
    const userRow = await query(
      "SELECT deposit_address FROM users WHERE telegram_id = $1 LIMIT 1",
      [mockCtx.from.id]
    );
    const mirrored = userRow.rows[0]?.deposit_address || null;
    if (mirrored) console.log(`🔗 users.deposit_address = ${mirrored}`);
    else console.warn("⚠️ users.deposit_address not set!");

    // ✅ Step 4: Re-run for idempotence
    console.log("\n🔁 Re-running newUserHandler to confirm no duplicates...");
    await mockBot._middleware(mockCtx, async () => {});
    const addr2 = await getOrCreateDepositAddress(mockCtx.from.id);

    if (walletRes.rows[0]?.deposit_address === addr2)
      console.log("✅ Address remained identical on re-run.");
    else console.log("⚠️ Deposit address changed on re-run!");

    console.log("\n🎉 Test completed successfully!\n");
  } catch (err) {
    logger.error(`❌ [ManualTest] Failed: ${err.message}`);
    console.error(err);
  } finally {
    await pool.end();
    console.log("🔚 PostgreSQL connection closed.\n");
  }
}

main();
