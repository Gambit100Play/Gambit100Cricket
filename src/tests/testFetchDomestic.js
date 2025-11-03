// src/tests/testFetchDomestic.js
import dotenv from "dotenv";
import axios from "axios";
import { fetchDomesticMatches } from "../api/fetchDomestic.js";
import { DateTime } from "luxon";

dotenv.config();

console.log("🚀 Starting Domestic fetch diagnostic test...");

const key = process.env.RAPIDAPI_KEY;
if (!key) {
  console.error("❌ No RAPIDAPI_KEY found in .env (check root .env file)");
  process.exit(1);
}

console.log("✅ Loaded RapidAPI key:", key.slice(0, 8) + "...");

const start = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
console.log(`🕒 Time: ${start}`);

(async () => {
  try {
    console.log("📡 Testing raw HTTP reachability first...");
    const testUrl = "https://cricbuzz-cricket2.p.rapidapi.com/schedule/v1/domestic?lastTime=1729555200000";
    const test = await axios.get(testUrl, {
      timeout: 15000,
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
      },
    });
    console.log("✅ Raw HTTP request succeeded. Type of data:", typeof test.data);
    console.log("   Raw keys:", Object.keys(test.data));

    console.log("\n🔍 Now calling your fetchDomesticMatches()...");
    const matches = await fetchDomesticMatches();

    if (!matches) {
      console.log("⚠️ fetchDomesticMatches() returned undefined/null");
      process.exit(0);
    }
    console.log(`✅ fetchDomesticMatches() returned ${matches.length} entries`);

    if (matches.length > 0) {
      console.log("🩵 Sample:");
      console.log(JSON.stringify(matches.slice(0, 2), null, 2));
    } else {
      console.log("⚠️ Empty array from fetchDomesticMatches()");
    }
  } catch (err) {
    console.error("🚨 Error during diagnostic test:");
    console.error(err);
  } finally {
    console.log("\n🧩 Diagnostic test finished.\n");
  }
})();
