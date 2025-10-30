// src/tests/testLockMatch.js
import { getMatchStatusSummary } from "../api/matchStatus.js";
import { getPoolInfo } from "../db/poolLogic.js";

import { createPoolHash } from "../utils/hashUtils.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { lockMatchPool } from "../db/db.js";
import { DateTime } from "luxon";

/**
 * 🧪 Manual test for LockMatchCron logic
 * Use this to verify everything works (API → hash → TRON → DB)
 */

async function testLockMatch(matchId) {
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`\n🚀 [Test] Running LockMatch Test for match ${matchId} at ${now}`);

  try {
    // Step 1: Get status from Cricbuzz
    const { state, toss } = await getMatchStatusSummary(matchId);
    console.log(`→ Match Status: ${state}`);
    console.log(`→ Toss Info: ${toss || "—"}`);

    // Detect if toss happened
    const isTossPhase =
      state.includes("toss") || toss.toLowerCase().includes("opt to") || toss.length > 0;

    if (!isTossPhase) {
      console.log("⏳ Toss not detected yet. Try again closer to match start.");
      return;
    }

    console.log("🎯 Toss detected! Proceeding to lock pre-match pool...");

    // Step 2: Fetch pool info (from DB)
    const poolInfo = await getPoolInfo(matchId);
    if (!poolInfo) {
      console.warn("⚠️ No pool info found for this match. Make sure pool exists in DB.");
      return;
    }

    // Step 3: Create pool hash
    const hash = createPoolHash(poolInfo);
    console.log(`🔐 Generated pool hash: ${hash}`);

    // Step 4: Publish hash to TRON
    const txid = await publishHashToTron(hash);
    console.log(`🔗 Published to TRON! Transaction ID: ${txid}`);

    // Step 5: Update DB and lock pool
    await lockMatchPool(matchId, hash, txid);
    console.log(`✅ Pool locked for match ${matchId}`);

    console.log("─────────────────────────────────────────────");
  } catch (err) {
    console.error("❌ Test failed:", err.message);
  }
}

// 🔧 Pass match ID here manually (change to any match)
const TEST_MATCH_ID = 121664;

testLockMatch(TEST_MATCH_ID);
