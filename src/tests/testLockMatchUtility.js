// ============================================================
// 🧪 Test Harness — LockMatchUtility Integration Test
// ============================================================
//
// Purpose:
// • Manually test lockMatchUtility() end-to-end
// • Fetch match by ID from DB
// • Attempt to lock all pools (PreMatch + Live)
// • Log every step clearly
//
// Usage:
//   node src/tests/testLockMatchUtility.js --match 136359
// ============================================================

import dotenv from "dotenv";
import { query, getMatchById } from "../db/db.js";
import { lockMatchUtility } from "../utils/lockMatchUtility.js";
import { logger } from "../utils/logger.js";

dotenv.config();

async function run() {
  try {
    // 🔹 Read CLI arg: --match <match_id>
    const argIndex = process.argv.indexOf("--match");
    if (argIndex === -1 || !process.argv[argIndex + 1]) {
      console.error("❌ Missing argument. Use: node src/tests/testLockMatchUtility.js --match <match_id>");
      process.exit(1);
    }

    const matchId = process.argv[argIndex + 1];
    console.log(`\n🧪 [Test] Starting LockMatchUtility test for matchId=${matchId}\n`);

    // 🔹 Fetch match details from DB
    const match = await getMatchById(matchId);
    if (!match) {
      console.error(`❌ No match found in DB for matchId=${matchId}`);
      process.exit(1);
    }

    console.log(`✅ Found match: ${match.team1 || "Team A"} vs ${match.team2 || "Team B"} | status=${match.status}`);

    // 🔹 Check how many pools exist before locking
    const beforePools = await query(
      `SELECT id, pool_type, status FROM pools WHERE matchid = $1 ORDER BY pool_type`,
      [String(matchId)]
    );
    console.log(`📊 Found ${beforePools.rows.length} pools before locking:`);
    beforePools.rows.forEach((r) => console.log(`   - ${r.pool_type} (${r.status})`));

    // 🔹 Run the actual lock utility
    console.log(`\n🚀 Running lockMatchUtility()...\n`);
    const success = await lockMatchUtility(match);

    if (success) console.log(`✅ LockMatchUtility executed successfully.`);
    else console.log(`⚠️ LockMatchUtility returned false (check logs).`);

    // 🔹 Verify changes in DB
    const afterPools = await query(
      `SELECT id, pool_type, status, lock_hash, tron_txid FROM pools WHERE matchid = $1 ORDER BY pool_type`,
      [String(matchId)]
    );
    console.log(`\n📊 Pools after locking:`);
    afterPools.rows.forEach((r) =>
      console.log(`   - ${r.pool_type} → ${r.status} | hash=${r.lock_hash?.slice(0, 8) || "none"} | txid=${r.tron_txid}`)
    );

    console.log(`\n🎯 Test completed successfully for matchId=${matchId}\n`);
    process.exit(0);
  } catch (err) {
    logger.error(`❌ [TestHarness] Error: ${err.stack || err.message}`);
    process.exit(1);
  }
}

run();
