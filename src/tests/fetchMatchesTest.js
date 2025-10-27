// src/test/fetchMatchesTest.js
import dotenv from "dotenv";
import { fetchMatches } from "../cron/fetchMatchesCron.js";

// Load environment variables
dotenv.config();

// 🕓 Helper logger
function stamp(...args) {
  console.log(
    "🕓",
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    "-",
    ...args
  );
}

(async () => {
  stamp("🧪 Starting manual fetch test...");

  try {
    const count = await fetchMatches();
    stamp(`✅ Successfully fetched and saved ${count} matches.`);
  } catch (err) {
    stamp(`❌ Test failed: ${err.message}`);
  }

  stamp("🏁 Test script complete.");
  process.exit(0);
})();
