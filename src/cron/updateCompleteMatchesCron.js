import cron from "node-cron";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { query, getPastActiveMatches } from "../db/db.js";

dotenv.config();
const CRICAPI_KEY = process.env.CRICAPI_KEY;

// ⚙️ Helper — Fetch match info from CricAPI
async function fetchMatchStatus(matchId) {
  const url = `https://api.cricapi.com/v1/match_info?apikey=${CRICAPI_KEY}&id=${matchId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const status = data?.data?.status?.toLowerCase() || "";
    return { status, data };
  } catch (err) {
    console.error(`❌ [Cron] Failed fetching status for ${matchId}:`, err.message);
    return null;
  }
}

// 🧩 Helper — Move completed match to completed_matches safely
async function archiveCompletedMatch(match) {
  try {
    const resultJSON = match.result ? JSON.stringify(match.result) : null;

    // 1️⃣ Insert into completed_matches
    const insertRes = await query(
      `
      INSERT INTO completed_matches (
        match_id, team_a, team_b, start_time, venue, toss_info, result, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      ON CONFLICT (match_id) DO NOTHING
      RETURNING match_id
      `,
      [
        match.match_id,
        match.team_a,
        match.team_b,
        match.start_time,
        match.venue,
        match.toss_info || null,
        resultJSON,
      ]
    );

    // 2️⃣ Delete only if inserted successfully
    if (insertRes.rowCount > 0) {
      await query(`DELETE FROM matches WHERE match_id = $1`, [match.match_id]);
      console.log(`📦 [Archive] Moved & deleted match ${match.match_id}`);
    } else {
      console.log(`⚠️ [Archive] Match ${match.match_id} already archived, skipping delete.`);
    }
  } catch (err) {
    console.error(`❌ [Archive] Failed for ${match.match_id}:`, err.message);
  }
}

// 🕒 Schedule — runs every minute (change to */15 * * * * for every 15min)
cron.schedule("* * * * *", async () => {
  console.log("🕒 [Cron] Checking for completed past matches...");

  try {
    const activeMatches = await getPastActiveMatches();
    if (!activeMatches.length) {
      console.log("✅ No past active matches found.");
      return;
    }

    for (const match of activeMatches) {
      const res = await fetchMatchStatus(match.match_id);
      if (!res) continue;

      const currentStatus = res.status;
      const apiData = res.data;

      // ✅ Detect completed/finished/abandoned states
      if (
        currentStatus.includes("completed") ||
        currentStatus.includes("finished") ||
        currentStatus.includes("result") ||
        currentStatus.includes("abandoned") ||
        currentStatus.includes("cancelled")
      ) {
        const result = {
          status: apiData?.data?.status || "completed",
          winner:
            apiData?.data?.teamInfo?.find((t) => t?.winner)?.name || null,
          note: apiData?.data?.status || null,
        };

        await archiveCompletedMatch({
          match_id: match.match_id,
          team_a: match.team_a,
          team_b: match.team_b,
          start_time: match.start_time,
          venue: match.venue,
          toss_info: match.toss_info,
          result,
        });
      }
    }

    console.log("🏁 [Cron] Completed matches archived successfully.\n");
  } catch (err) {
    console.error("❌ [Cron] Error during completed matches check:", err.message);
  }
});
