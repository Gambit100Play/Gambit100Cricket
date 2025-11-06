// src/cron/PreMatchBetLockCron.js
import cron from "node-cron";
import { DateTime } from "luxon";
import {
  getPendingPrematchMatches,
  lockMatchPool,
  query,
} from "../db/db.js";
import { getMatchStatusSummary } from "../api/matchStatus.js";
import { createPoolHash } from "../utils/hashUtils.js";
import { publishHashToTron } from "../utils/tronPublisher.js";
import bot from "../bot/bot.js";

console.log("🕒 [Cron] PreMatchBetLockCron initialized.");

/* ============================================================
 📢 Notify participants that the pool is locked
============================================================ */
async function notifyParticipants(match, txid, participants) {
  const msg =
    `🔒 *Pre-Match Locked*\n` +
    `🏏 ${match.team1} vs ${match.team2}\n\n` +
    `Betting is now closed — toss window ended or first ball bowled.\n` +
    `_Tx Hash:_ \`${txid}\``;

  for (const p of participants) {
    try {
      await bot.telegram.sendMessage(p.telegram_id, msg, {
        parse_mode: "Markdown",
      });
      await new Promise((r) => setTimeout(r, 100)); // anti-flood delay
    } catch (e) {
      console.warn(`⚠️ Couldn’t DM user ${p.telegram_id}: ${e.message}`);
    }
  }

  if (process.env.ADMIN_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(
        process.env.ADMIN_CHAT_ID,
        `✅ Locked pre-match pool for ${match.team1} vs ${match.team2}`,
        { parse_mode: "Markdown" }
      );
    } catch {}
  }
}

/* ============================================================
 🧩 CRON — every 5 minutes
============================================================ */
cron.schedule("*/5 * * * *", async () => {
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat(
    "dd LLL yyyy, hh:mm a"
  );
  console.log(`\n[PreMatchBetLockCron] Tick → ${now}`);

  try {
    const pending = await getPendingPrematchMatches();
    if (!pending.length) {
      console.log("✅ No pre-match pools waiting to be locked.");
      return;
    }

    for (const match of pending) {
      // Skip if already locked (extra idempotent layer)
      if (match.prematch_locked) {
        console.log(
          `🚫 Match ${match.match_id} already locked at ${match.prematch_locked_at || "unknown"}`
        );
        continue;
      }

      console.log(`→ Checking ${match.match_id}: ${match.team1} vs ${match.team2}`);

      try {
        // 1️⃣ Fetch current match summary
        const summary = await getMatchStatusSummary(match.match_id);
        if (!summary || summary.state === "unknown") {
          console.log("⚠️ Could not fetch valid match status — skipping...");
          continue;
        }

        const { state, toss, overs, innings, team1, team2 } = summary;
        const lowerState = (state || "").toLowerCase();
        const lowerToss = (toss || "").toLowerCase();
        const firstBallBowled = Number(overs) > 0 || Number(innings) > 0;

        console.log(
          `   📡 Status → state="${state}", toss="${toss}", overs=${overs}, innings=${innings}`
        );

        // 2️⃣ Record toss time if newly detected
        if (
          (lowerToss.includes("opt to") || lowerToss.includes("elected to")) &&
          !match.toss_detected_at
        ) {
          await query(
            `UPDATE matches SET toss_detected_at = NOW() WHERE match_id = $1`,
            [match.match_id]
          );
          console.log(`📅 Toss detected → timestamp saved for match ${match.match_id}`);
        }

        // 3️⃣ Time since toss (if recorded)
        let minutesSinceToss = 0;
        if (match.toss_detected_at) {
          const tossTime = DateTime.fromJSDate(match.toss_detected_at);
          minutesSinceToss = DateTime.utc().diff(tossTime, "minutes").minutes;
        }

        // 4️⃣ Lock conditions
        const fiveMinAfterToss = minutesSinceToss >= 5;
        const tossDetected =
          lowerToss.includes("opt to") || lowerToss.includes("elected to");

        const isReadyToLock = firstBallBowled || (tossDetected && fiveMinAfterToss);

        if (!isReadyToLock) {
          if (tossDetected && !fiveMinAfterToss) {
            const remaining = Math.max(0, 5 - Math.floor(minutesSinceToss));
            console.log(
              `⏳ Toss done — waiting ${remaining} more minute(s) before locking...`
            );
          } else {
            console.log("⏳ Match still in preview — waiting for toss or first ball...");
          }
          continue;
        }

        console.log(`⚠️ Conditions met → locking pool for ${match.match_id}`);

        // 5️⃣ Fetch full pool snapshot
        const pool = await getPoolInfo(match.match_id, "PreMatch");
        if (!pool || !pool.rows?.length) {
          console.warn(`⚠️ No pre-match pool found in DB for match ${match.match_id}`);
          continue;
        }

        // 6️⃣ Create on-chain hash
        const poolHash = createPoolHash(pool.rows);
        console.log(`   🔐 Pool Hash: ${poolHash}`);

        // 7️⃣ Publish hash to TRON
        let txid = "TEST_TX_ID";
        try {
          const network = (process.env.NETWORK || "").toLowerCase();
          if (network === "shasta" || network === "mainnet") {
            txid = await publishHashToTron(poolHash);
            console.log(`   🔗 TRON TxID: ${txid}`);
          } else {
            console.log("   🧪 [Mock] Skipping TRON publish (dev mode).");
          }
        } catch (tronErr) {
          console.error(`⚠️ TRON publish failed: ${tronErr.message}`);
        }

        // 8️⃣ Mark DB locked (using your actual column names)
        await query(
          `
          UPDATE matches
          SET prematch_locked = TRUE,
              prematch_locked_at = NOW(),
              pool_hash = $1,
              tron_txid = $2
          WHERE match_id = $3
          `,
          [poolHash, txid, match.match_id]
        );
        console.log(`✅ [DB] Locked pre-match pool for ${match.match_id}`);

        // 9️⃣ Notify participants
        const res = await query(
          `SELECT DISTINCT telegram_id
             FROM bets
            WHERE match_id = $1
              AND LOWER(market_type) = 'prematch'`,
          [String(match.match_id)]
        );
        const participants = res.rows || [];

        if (participants.length) {
          await notifyParticipants({ team1, team2 }, txid, participants);
        } else {
          console.log("ℹ️ No participants to notify.");
        }
      } catch (e) {
        console.error(`❌ Error while processing match ${match.match_id}: ${e.message}`);
      }
    }
  } catch (err) {
    console.error("🚨 [PreMatchBetLockCron] Fatal:", err.message);
  }

  console.log("──────────────────────────────────────────────");
});
