/**
 * 🧪 Standalone Concurrent Betting Simulation
 * --------------------------------------------------------
 * This test simulates multiple users placing bets concurrently
 * using your actual PostgreSQL connection and transactional logic.
 *
 * Run this test independently:
 * 
 *    node src/tests/simulateConcurrentBets.js
 *
 * Ensure:
 *  - .env has your Postgres credentials
 *  - `matches`, `users`, `balances`, and `bets` tables exist
 */

import dotenv from "dotenv";
import {
  placeBetWithDebit,
  createUser,
  getUserBalance,
  getDynamicOdds,
  getPoolSummary,
} from "../db/db.js";

dotenv.config();

// 🏏 CONFIGURATION
const TEST_MATCH_ID = "test-match-001";
const TEST_MATCH_NAME = "India vs Australia";
const TEST_BET_TYPE = "Prematch";
const TEST_BET_OPTION = "India to Win";
const TEST_STAKE = 100; // stake in G tokens
const USER_COUNT = 5; // simulate 5 concurrent users

// 🧠 Create fake Telegram users
const fakeUsers = Array.from({ length: USER_COUNT }, (_, i) => ({
  telegramId: 9200 + i, // unique Telegram IDs
  username: `SimUser_${i + 1}`,
}));

// ------------------------------------------------------------
// 🧩 STEP 1: Ensure users exist and are initialized
// ------------------------------------------------------------
async function setupUsers() {
  console.log("👤 Setting up test users...");
  for (const user of fakeUsers) {
    await createUser(user.telegramId, user.username);
  }
  console.log("✅ Users created or verified.");
}

// ------------------------------------------------------------
// 🧩 STEP 2: Simulate a single user's betting transaction
// ------------------------------------------------------------
async function simulateUserBet(user) {
  try {
    const before = await getUserBalance(user.telegramId);

    console.log(
      `\n🎯 [${user.username}] Starting bet → Tokens=${before.tokens}, Bonus=${before.bonus_tokens}`
    );

    const result = await placeBetWithDebit({
      telegramId: user.telegramId,
      matchId: TEST_MATCH_ID,
      matchName: TEST_MATCH_NAME,
      betType: TEST_BET_TYPE,
      betOption: TEST_BET_OPTION,
      stake: TEST_STAKE,
    });

    const after = result.balance;
    console.log(
      `✅ [${user.username}] Bet placed successfully → Tokens=${after.tokens}, Bonus=${after.bonus}`
    );
  } catch (err) {
    console.error(`❌ [${user.username}] Failed:`, err.message);
  }
}

// ------------------------------------------------------------
// 🧩 STEP 3: Run all users’ bets concurrently
// ------------------------------------------------------------
async function runConcurrentSimulation() {
  console.log("🚀 Starting concurrent betting simulation...\n");

  await setupUsers();

  // Run all bets simultaneously
  const promises = fakeUsers.map((u) => simulateUserBet(u));
  await Promise.allSettled(promises);

  // Fetch updated odds and pool summary
  console.log("\n⏳ Fetching final pool summary...");
  const pool = await getPoolSummary(TEST_MATCH_ID);
  const odds = await getDynamicOdds(TEST_MATCH_ID, TEST_BET_TYPE);

  // Print summary
  console.log("\n🏁 Final Results:");
  console.log("👥 Participants:", pool.participants);
  console.log("💰 Total Pool Size:", pool.total_stake);
  console.table(odds);

  console.log("\n✅ Simulation complete. Check DB for results (bets & balances).");
}

// ------------------------------------------------------------
// 🧩 STEP 4: Execute and exit safely
// ------------------------------------------------------------
runConcurrentSimulation()
  .then(() => {
    console.log("\n🎯 Test run completed successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n💥 Test run failed:", err);
    process.exit(1);
  });
