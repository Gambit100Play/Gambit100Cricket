// src/cron/LockMatchCron.js
import cron from "node-cron";
import { DateTime } from "luxon";
import {
  getPendingPrematchMatches,
  lockMatchPool,
  getPoolInfo,
  query,
} from "../db/db.js";
import { createPoolHash } from "../utils/hashUtils.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import { getMatchStatusSummary } from "../api/matchStatus.js";
import { bot } from "../bot/bot.js";

/**
 * 🔒 LockMatchCron
 * Runs every 5 minutes → checks Cricbuzz match status via matchStatus.js
 * If match reaches toss phase, locks pre-match pool and publishes its hash to TRON.
 */

console.log("🕒 [Cron] LockMatchCron initialized.");

/* ============================================================
 🧠 Helper: Broadcast pool lock notifications
============================================================ */
async function notifyPoolParticipants(match, participants) {
  const message = `🔒 *Pre-Match Locked*\n` +
    `🏏 ${match.team1 || "Team A"} vs ${match.team2 || "Team B"}\n\n` +
    `Toss has occurred — betting is now closed.\n` +
    `All pre-match bets are final.\n\n` +
    `_Tx Hash:_ \`${match.tron_txid || "N/A"}\``;

  // Send to each participant
  for (const p of participants) {
    try {
      await bot.telegram.sendMessage(p.telegram_id, message, {
        parse_mode: "Markdown",
      });
      await new Promise((r) => setTimeout(r, 100)); // rate limit safety
    } catch (err) {
      console.warn(`⚠️ Failed to notify user ${p.telegram_id}: ${err.message}`);
    }
  }

  // Notify admin as well (optional)
  if (process.env.ADMIN_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, `✅ Pool locked for ${match.team1} vs ${match.team2}`, {
        parse_mode: "Markdown",
      });
    } catch {}
  }
}

/* ============================================================
 🧩 CRON JOB — Every 5 minutes
============================================================ */
cron.schedule("*/5 * * * *", async () => {
  const now = DateTime.now()
    .setZone("Asia/Kolkata")
    .toFormat("dd LLL yyyy, hh:mm a");
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

        // ⚙️ Determine if toss has occurred
        const isTossPhase =
          (state && state.toLowerCase().includes("toss")) ||
          (toss && toss.toLowerCase().includes("opt to"));

        if (!isTossPhase) {
          console.log("⏳ Match still in pre-match state. Waiting for toss...");
          continue;
        }

        // 🧩 Toss detected → Lock pre-match pool
        console.log(`⚠️ Toss detected — locking pre-match pool for match ${match.match_id}`);

        // Step 1: Get pool snapshot from DB
        const poolInfo = await getPoolInfo(match.match_id);
        if (!poolInfo) {
          console.warn(`⚠️ No pool info found for match ${match.match_id}, skipping...`);
          continue;
        }

        // Step 2: Create hash for pool integrity proof
        const hash = createPoolHash(poolInfo);
        console.log(`   🔐 Pool hash generated: ${hash}`);

        // Step 3: Publish hash on TRON blockchain
        const txid = await publishHashToTron(hash);
        console.log(`   🔗 Published to TRON. TxID: ${txid}`);

        // Step 4: Update DB (mark locked)
        await lockMatchPool(match.match_id, hash, txid);
        console.log(`✅ [DB] Pool locked for match ${match.match_id}`);

        // Step 5: Fetch pool participants
        const participantsRes = await query(
          `SELECT DISTINCT telegram_id FROM bets WHERE match_id = $1`,
          [String(match.match_id)]
        );
        const participants = participantsRes.rows || [];

        // Step 6: Broadcast messages
        if (bot && participants.length > 0) {
          await notifyPoolParticipants(
            { ...match, tron_txid: txid },
            participants
          );
        } else {
          console.log("ℹ️ No participants to notify or bot not loaded.");
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
