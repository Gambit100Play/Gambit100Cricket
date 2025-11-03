// src/tests/testFetchWomen.js
import dotenv from "dotenv";
import axios from "axios";
import { DateTime } from "luxon";
import { fetchWomenMatches } from "../api/fetchWomen.js";

dotenv.config();

async function testFetchWomen() {
  console.log("🚀 Starting Women’s match fetch diagnostic test...");

  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.error("❌ RAPIDAPI_KEY missing in environment variables!");
    return;
  }

  console.log(`✅ Loaded RapidAPI key: ${key.slice(0, 8)}...`);
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`🕒 Time: ${now}`);

  // Step 1️⃣ — Check raw API response
  const testUrl = "https://cricbuzz-cricket2.p.rapidapi.com/schedule/v1/women";
  const params = { lastTime: "1729641600000" };
  const headers = {
    "x-rapidapi-key": key,
    "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
  };

  console.log("📡 Testing raw HTTP reachability first...");

  try {
    const res = await axios.get(testUrl, { params, headers, timeout: 20000 });
    console.log(`✅ Raw HTTP request succeeded. Type of data: ${typeof res.data}`);
    console.log(`   Raw keys: [ ${Object.keys(res.data).join(", ")} ]\n`);
  } catch (err) {
    console.error("🚨 Raw request failed:", err.message);
    return;
  }

  // Step 2️⃣ — Test wrapped function
  console.log("🔍 Now calling fetchWomenMatches()...");

  try {
    const matches = await fetchWomenMatches();

    if (!matches || matches.length === 0) {
      console.log("⚠️ No Women’s matches found (possibly no fixtures currently listed).");
      return;
    }

    console.log(`✅ Successfully fetched ${matches.length} matches!\n`);
    matches.slice(0, 5).forEach((m, i) => {
      console.log(`${i + 1}. ${m.team1} vs ${m.team2} — ${m.match_desc} (${m.series_name})`);
      console.log(`   🏟️ ${m.venue}, ${m.city}, ${m.country}`);
      console.log(`   🕒 ${m.start_date}\n`);
    });

    console.log("🎯 [Test] Women’s fetch successful.\n");
  } catch (err) {
    console.error("🚨 [Test] Error running fetchWomenMatches:", err.message);
  }
}

// Auto-run
testFetchWomen();
