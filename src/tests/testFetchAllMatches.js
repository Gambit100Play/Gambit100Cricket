// src/tests/testFetchAllMatches.js
import dotenv from "dotenv";
import { DateTime } from "luxon";
import { ensureUpcomingMatches } from "../api/fetchAllMatches.js";
import { pool } from "../db/db.js";

dotenv.config();

async function testFetchAllMatches() {
  console.log("🚀 Starting unified FetchAll diagnostic test...");
  const key = process.env.RAPIDAPI_KEY;

  if (!key) {
    console.error("❌ RAPIDAPI_KEY missing from environment!");
    return;
  }

  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`🕒 Time: ${now}`);
  console.log("🔍 Initiating fetch from all endpoints...\n");

  try {
    await ensureUpcomingMatches();

    console.log("\n📊 Fetch complete — verifying DB contents...");

    const { rows } = await pool.query(
      `SELECT status, COUNT(*) FROM matches GROUP BY status ORDER BY status;`
    );

    console.log("📦 Summary by status:");
    for (const row of rows) {
      console.log(`   • ${row.status} → ${row.count} matches`);
    }

    const { rows: latest } = await pool.query(
      `SELECT match_id, team1, team2, match_desc, series_name, status
       FROM matches ORDER BY start_date ASC LIMIT 5;`
    );

    console.log("\n🩵 Sample of earliest 5 upcoming/live matches:");
    latest.forEach((m) => {
      console.log(
        `   ${m.team1} vs ${m.team2} — ${m.match_desc} (${m.series_name}) [${m.status}]`
      );
    });

    console.log("\n🎯 [Test] FetchAll matches test completed successfully.");
  } catch (err) {
    console.error("🚨 [Test] Error running unified fetch:", err.message);
  } finally {
    await pool.end();
  }
}

// Run directly when executed
testFetchAllMatches();
