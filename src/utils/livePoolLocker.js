// src/utils/livePoolLocker.js
import crypto from "crypto";
import { query } from "../db/db.js";
import { publishHashToTron } from "./tronPublisher.js";

export async function lockLivePool(matchId, startOver, endOver) {
  try {
    const { rows } = await query(
      `SELECT id, category, threshold, options
       FROM live_pools
       WHERE matchid=$1 AND start_over=$2 AND end_over=$3 AND status='active'`,
      [matchId, startOver, endOver]
    );

    if (!rows.length) {
      console.log(`⚠️ [lockLivePool] No active pool found for overs ${startOver}-${endOver}`);
      return;
    }

    const pool = rows[0];
    const payload = {
      category: pool.category,
      threshold: pool.threshold,
      start_over: startOver,
      end_over: endOver,
      options: pool.options,
    };

    const poolHash = crypto.createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    let txid = "LOCAL_TEST_TXID";
    const network = (process.env.NETWORK || "").toLowerCase();

    if (["shasta", "mainnet"].includes(network)) {
      try {
        txid = await publishHashToTron(poolHash);
        console.log(`🔗 TRON TxID: ${txid}`);
      } catch (err) {
        console.error(`⚠️ Tron publish failed: ${err.message}`);
      }
    } else {
      console.log("🧪 [MockTRON] Skipping network publish in local mode.");
    }

    await query(
      `UPDATE live_pools
         SET status='locked',
             locked_at=NOW(),
             pool_hash=$1,
             tron_txid=$2
       WHERE id=$3`,
      [poolHash, txid, pool.id]
    );

    console.log(`🔒 Pool locked (${pool.category}) overs ${startOver}-${endOver} for match ${matchId}`);
  } catch (err) {
    console.error(`❌ [lockLivePool] Error: ${err.message}`);
  }
}
