// src/tests/testTronPublish.js
import dotenv from "dotenv";
dotenv.config(); // 🧩 must load BEFORE other imports

import { publishHashMemo } from "../utils/tronPublisher.js"; // ✅ correct import path

(async () => {
  try {
    // 👋 Environment sanity check
    console.log("🔧 ENV CHECK:", {
      TRON_FULL_NODE: process.env.TRON_FULL_NODE || "❌ missing",
      TRON_SENDER: process.env.TRON_SENDER || "❌ missing",
      TRON_PRIVATE_KEY: process.env.TRON_PRIVATE_KEY
        ? `✅ loaded (${process.env.TRON_PRIVATE_KEY.slice(0, 6)}…)`
        : "❌ missing",
    });

    // 🧠 Create a random dummy hash
    const dummyHash = "pool-lock-test-" + Math.random().toString(36).slice(2, 10);
    console.log(`\n🔐 Attempting to publish hash: ${dummyHash}`);

    // 🧾 Try publishing the hash to TRON
    const result = await publishHashMemo(dummyHash, "TestLock");

    // ✅ Log result
    console.log("\n✅ Hash successfully published on Tron!");
    console.log(`🧩 Memo: ${result.memo}`);
    console.log(`🔗 TXID: ${result.txid}`);
    console.log(`🌍 Explorer: ${result.explorer}\n`);
  } catch (err) {
    console.error("\n❌ Failed to publish hash!");
    console.error("Reason:", err.message);
  }
})();
