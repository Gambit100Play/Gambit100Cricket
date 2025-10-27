/**
 * 🧪 Offline Simulation of 5 Concurrent Users
 * ------------------------------------------------
 * This test does NOT talk to Telegram servers.
 * It directly uses DB + betting logic (placeBetWithDebit)
 * to simulate real users placing bets concurrently.
 */

import { placeBetWithDebit, createUser, getUserBalance, getDynamicOdds } from "../db/db.js";
import dotenv from "dotenv";

dotenv.config();

// 🏏 Test config
const TEST_MATCH_ID = "test-match-001";
const TEST_MATCH_NAME = "India vs Australia";
const TEST_BET_TYPE = "Prematch";
const BET_OPTIONS = ["India to Win", "Australia to Win", "Draw / Tie"];
const USER_COUNT = 5;
const TEST_STAKE = 100;

// 🔹 Fake users
const fakeUsers = Array.from({ length: USER_COUNT }, (_, i) => ({
  telegramId: 8100 + i,
  username: `OfflineUser_${i + 1}`,
}));

// 🔹 Simulate bet for one user
async function simulateBet(user) {
  try {
    await createUser(user.telegramId, user.username);

    const balanceBefore = await getUserBalance(user.telegramId);
    console.log(
      `🎯 [${user.username}] Balance: tokens=${balanceBefore.tokens}, bonus=${balanceBefore.bonus_tokens}`
    );

    // Random bet option
    const betOption = BET_OPTIONS[Math.floor(Math.random() * BET_OPTIONS.length)];

    const result = await placeBetWithDebit({
      telegramId: user.telegramId,
      matchId: TEST_MATCH_ID,
      matchName: TEST_MATCH_NAME,
      betType: TEST_BET_TYPE,
      betOption,
      stake: TEST_STAKE,
    });

    const b = result.balance;
    console.log(
      `✅ [${user.username}] Bet placed: ${betOption} | stake=${TEST_STAKE} | tokens=${b.tokens}, bonus=${b.bonus}`
    );
  } catch (err) {
    console.error(`❌ [${user.username}] ${err.message}`);
  }
}

// 🔹 Run all users concurrently
async function runOfflineTest() {
  console.log("🚀 Simulating 5 concurrent offline users...");
  await Promise.all(fakeUsers.map(simulateBet));

  console.log("\n📊 Fetching updated odds...\n");
  const odds = await getDynamicOdds(TEST_MATCH_ID, TEST_BET_TYPE);

  console.table(odds);
  console.log("\n🏁 Offline simulation complete!");
}

// Execute test
runOfflineTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("💥 Simulation failed:", err);
    process.exit(1);
  });
