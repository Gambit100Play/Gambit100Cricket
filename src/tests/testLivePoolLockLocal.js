/**
 * ============================================================
 * 🧪 TEST: Live Pool Lock Simulation (Local Mode)
 * ------------------------------------------------------------
 * → Simulates live pools being locked every 2 overs.
 * → Uses mock data — no API calls, no DB, no TRON network.
 * ============================================================
 */

import crypto from "crypto";
import { DateTime } from "luxon";

// Mock data representing "live_pools" table
const livePools = [
  {
    id: 1,
    matchid: 124381,
    category: "score",
    start_over: 122,
    end_over: 124,
    threshold: 502,
    status: "active",
    options: { over: 0, under_equal: 0 },
  },
  {
    id: 2,
    matchid: 124381,
    category: "wickets",
    start_over: 122,
    end_over: 124,
    threshold: 10,
    status: "active",
    options: { over: 0, under_equal: 0 },
  },
  {
    id: 3,
    matchid: 124381,
    category: "boundaries",
    start_over: 122,
    end_over: 124,
    threshold: 49,
    status: "active",
    options: { over: 0, under_equal: 0 },
  },
];

// Simulated live matches
const mockMatches = [
  { match_id: 124381, team1: "Odisha", team2: "Andhra" },
  { match_id: 124475, team1: "Assam", team2: "Railways" },
];

/* ============================================================
 🔐 Hash Generator (Mocked)
============================================================ */
function createPoolHash(pool) {
  const payload = {
    category: pool.category,
    threshold: pool.threshold,
    start_over: pool.start_over,
    end_over: pool.end_over,
    options: pool.options,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/* ============================================================
 🧠 Mock “fetch current overs”
============================================================ */
function fetchCurrentOvers(matchId) {
  // You can change these between test runs to simulate match progress
  const fakeOversMap = {
    124381: 125.1, // triggers locking (since >124)
    124475: 50.3,  // not yet ready
  };
  const overs = fakeOversMap[matchId] || 0;
  console.log(`🧪 [MockOvers] match=${matchId} → returning overs=${overs}`);
  return overs;
}

/* ============================================================
 🔒 Main Locking Simulation
============================================================ */
async function runLivePoolLockTest() {
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm:ss a");
  console.log(`\n[LivePoolLockTest] Tick → ${now}`);
  console.log("===========================================");

  for (const match of mockMatches) {
    const currentOvers = fetchCurrentOvers(match.match_id);

    const poolsToLock = livePools.filter(
      (p) => p.matchid === match.match_id && p.status === "active" && p.end_over <= currentOvers
    );

    if (!poolsToLock.length) {
      console.log(`⏳ ${match.team1} vs ${match.team2} → No pools ready to lock.`);
      continue;
    }

    for (const pool of poolsToLock) {
      // Step 1️⃣ Create hash
      const poolHash = createPoolHash(pool);

      // Step 2️⃣ Mock TRON publish
      const txid = "LOCAL_TX_" + pool.id.toString().padStart(4, "0");

      // Step 3️⃣ Lock pool
      pool.status = "locked";
      pool.locked_at = new Date().toISOString();
      pool.pool_hash = poolHash;
      pool.tron_txid = txid;

      console.log(
        `🔒 Locked [${pool.category}] pool (${pool.start_over}-${pool.end_over} overs)` +
          ` for ${match.team1} vs ${match.team2}`
      );
      console.log(`   🔐 Hash: ${poolHash}`);
      console.log(`   🔗 TRON TxID: ${txid}`);
    }
  }

  console.log("\n✅ All eligible pools processed.\n");
  console.log("Final pool states:");
  console.table(livePools, ["id", "category", "status", "locked_at", "tron_txid"]);
  console.log("===========================================");
}

// Run the simulation
runLivePoolLockTest();
