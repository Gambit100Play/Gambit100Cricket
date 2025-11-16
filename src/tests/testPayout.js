// ============================================================
// 🧪 Test Runner — PayoutHandler
// ============================================================
//
// Run this file with:
//    node testPayout.js
//
// Make sure your database is running and your environment vars
// (like PG credentials in .env) are loaded correctly.
//
// ============================================================

import dotenv from "dotenv";
import { handlePayoutsForMatch } from "../bot/handlers/payoutHandler.js";

// Load .env variables (if any)
dotenv.config();

// Utility for clean exit and error capture
async function run() {
  const testMatchId = 999999;   // <-- your test match ID
  const mode = "final";         // or "chunk" for live pool payout test

  console.log("=================================================");
  console.log("💰  Starting PayoutHandler Test");
  console.log("=================================================");
  console.log(`🧩  Match ID : ${testMatchId}`);
  console.log(`⚙️   Mode     : ${mode}\n`);

  try {
    await handlePayoutsForMatch(testMatchId, mode);

    console.log("\n=================================================");
    console.log("✅  PayoutHandler test completed successfully");
    console.log("=================================================\n");
  } catch (err) {
    console.error("\n=================================================");
    console.error("❌  PayoutHandler test failed!");
    console.error("-------------------------------------------------");
    console.error(err);
    console.error("=================================================\n");
  } finally {
    process.exit();
  }
}

run();
