// src/cron/LockMatchCron.js
import cron from "node-cron";
import { DateTime } from "luxon";
import { getPendingPrematchMatches, lockMatchPool, getPoolInfo } from "../db/db.js";
import { createPoolHash } from "../utils/hashUtils.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { getMatchStatusSummary } from "../api/matchStatus.js";

/**
 * 🔒 LockMatchCron
 * Runs every 5 minutes → checks Cricbuzz match status via matchStatus.js
 * If match has reached toss phase, locks pre-match pool and publishes its hash to TRON.
 */

console.log("🕒 [Cron] LockMatchCron initialized.");

cron.schedule("*/5 * * * *", async () => {
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`\n[LockMatchCron] Running at ${now} 🕒`);

  try {
    const pendingMatches = await getPendingPrematchMatches();

    if (!pendingMatches.length) {
      console.log("✅ No pending pre-match pools to check.");
      return;
    }

    for (const match of pendingMatches) {
      console.log(`→ Checking match ${match.match_id}: ${match.team1} vs ${match.team2}`);

      try {
        // 🧠 Get current match state & toss info
        const { state, toss } = await getMatchStatusSummary(match.match_id);
        console.log(`   ↳ Current state: ${state} | Toss: ${toss || "—"}`);

        // ⚙️ Normalize possible Cricbuzz states
        const isTossPhase =
          state.includes("toss") || toss.toLowerCase().includes("opt to") || toss.length > 0;

        // 🧩 If toss detected — lock the pre-match pool
        if (isTossPhase) {
          console.log(`⚠️ Toss detected — locking pre-match pool for match ${match.match_id}`);

          // Step 1: Get pool snapshot from DB
          const poolInfo = await getPoolInfo(match.match_id);
          if (!poolInfo) {
            console.warn(`⚠️ No pool info found for match ${match.match_id}, skipping...`);
            continue;
          }

          // Step 2: Create hash for integrity proof
          const hash = createPoolHash(poolInfo);
          console.log(`   🔐 Pool hash generated: ${hash}`);

          // Step 3: Publish hash on TRON blockchain
          const txid = await publishHashToTron(hash);
          console.log(`   🔗 Published to TRON. TxID: ${txid}`);

          // Step 4: Mark match as locked in DB
          await lockMatchPool(match.match_id, hash, txid);
          console.log(`✅ Successfully locked pool for match ${match.match_id}`);
        } else {
          console.log("⏳ Match still in pre-match state. Waiting for toss...");
        }
      } catch (matchErr) {
        console.error(`❌ Error processing match ${match.match_id}:`, matchErr.message);
      }
    }
  } catch (err) {
    console.error("🚨 [LockMatchCron] Critical failure:", err.message);
  }

  console.log("─────────────────────────────────────────────");
});
