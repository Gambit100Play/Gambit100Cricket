import dotenv from "dotenv";
import axios from "axios";
import { DateTime } from "luxon";
import { fetchLeagueMatches } from "../api/fetchLeague.js";

dotenv.config();

async function testFetchLeague() {
  console.log("🚀 Starting League fetch diagnostic test...");

  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.error("❌ RAPIDAPI_KEY missing in environment variables!");
    return;
  }

  console.log(`✅ Loaded RapidAPI key: ${key.slice(0, 8)}...`);
  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`🕒 Time: ${now}`);

  // Step 1️⃣ — Check raw reachability
  const testUrl = "https://cricbuzz-cricket2.p.rapidapi.com/schedule/v1/league";
  const params = { lastTime: "1729555200000" };
  const headers = {
    "x-rapidapi-key": key,
    "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
  };

  console.log("📡 Testing raw HTTP reachability first...");
  try {
    const res = await axios.get(testUrl, { params, headers, timeout: 20000 });
    console.log(`✅ Raw HTTP succeeded. Keys: [ ${Object.keys(res.data).join(", ")} ]\n`);
  } catch (err) {
    console.error("🚨 Raw request failed:", err.message);
    return;
  }

  // Step 2️⃣ — Use your wrapped fetcher
  console.log("🔍 Running fetchLeagueMatches()...\n");

  try {
    const matches = await fetchLeagueMatches();
    if (!matches || matches.length === 0) {
      console.log("⚠️ No league matches found from Cricbuzz (possibly no active fixtures).");
      return;
    }

    console.log(`✅ Successfully fetched ${matches.length} matches!\n`);
    matches.slice(0, 5).forEach((m, i) => {
      console.log(`${i + 1}. ${m.team1} vs ${m.team2} — ${m.match_desc} (${m.series_name})`);
      console.log(`   🏟️ ${m.venue}, ${m.city}, ${m.country}`);
      console.log(`   🕒 ${m.start_date}\n`);
    });
  } catch (err) {
    console.error("🚨 [Test] Error running fetchLeagueMatches:", err.message);
  }
}

// Auto-run
if (process.argv[1].includes("testFetchLeague.js")) {
  testFetchLeague();
}

