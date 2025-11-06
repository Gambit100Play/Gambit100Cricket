// src/cron/watchMatches.js
import { getMatchById, updateMatchStatus } from "../db/db.js";
import { lockPreMatchPool } from "../services/poolLocker.js";

/**
 * Checks if a match has reached toss stage and locks its pre-match pool.
 * @param {string|number} matchId 
 * @param {string} apiStatus - live status from match API ("toss", "live", etc)
 */
export async function maybeLockPool(matchId, apiStatus) {
  try {
    if (String(apiStatus).toLowerCase() === "toss") {
      console.log(`🎯 Toss detected for match ${matchId} → attempting pool lock...`);
      
      const res = await lockPreMatchPool(matchId);
      if (res?.status === "locked") {
        console.log(
          `🔐 Pool locked for ${matchId}\n` +
          `   • Hash: ${res.hashHex}\n` +
          `   • Tron TxID: ${res.tronTxId}`
        );

        // Optional: sync match status in local DB
        await updateMatchStatus(matchId, "toss");
      } else {
        console.warn(`⚠️ Pool lock skipped — ${res?.message || "unknown reason"}`);
      }
    }
  } catch (err) {
    console.error(`❌ maybeLockPool failed for ${matchId}:`, err.message);
  }
}
