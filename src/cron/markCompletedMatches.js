import cron from "node-cron";
import https from "https";
import dotenv from "dotenv";
import { pool, query, getPastActiveMatches } from "../db/db.js"; // ✅ Added pool import for transactions

dotenv.config();
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// 🧠 Helper — Fetch match status safely from Cricbuzz API
async function fetchMatchStatus(matchId) {
  const options = {
    method: "GET",
    hostname: "cricbuzz-cricket2.p.rapidapi.com",
    path: `/mcenter/v1/${matchId}`,
    headers: {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
    },
    timeout: 10000, // 10s timeout
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (!data || !data.trim()) {
          console.warn(`⚠️ [Cron] Empty response for match ${matchId}`);
          return resolve(null);
        }
        try {
          const parsed = JSON.parse(data);
          const status = parsed?.state?.toLowerCase() || "";
          resolve({ status, data: parsed });
        } catch (err) {
          console.error(`❌ [Cron] JSON parse error for ${matchId}: ${err.message}`);
          console.error(`→ Raw (truncated):`, data.slice(0, 120));
          resolve(null);
        }
      });
    });

    req.on("timeout", () => {
      console.warn(`⚠️ [Cron] Timeout fetching match ${matchId}`);
      req.destroy();
      resolve(null);
    });

    req.on("error", (err) => {
      console.error(`❌ [Cron] HTTPS error for ${matchId}:`, err.message);
      resolve(null);
    });

    req.end();
  });
}

// 📦 Archive completed match → completed_matches
async function archiveCompletedMatch(match) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO completed_matches (
        match_id, team_a, team_b, start_time, venue, toss_info, result, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (match_id) DO NOTHING;
      `,
      [
        String(match.match_id),
        match.team_a,
        match.team_b,
        match.start_time,
        match.venue,
        match.toss_info || null,
        match.result || null,
      ]
    );

    // ✅ Delete by text-safe ID
    const del = await client.query(`DELETE FROM matches WHERE id = $1::text`, [
      String(match.match_id),
    ]);

    if (del.rowCount > 0)
      console.log(`✅ [Archive] Match ${match.match_id} moved to completed_matches.`);
    else
      console.warn(`⚠️ [Archive] No match deleted for ID ${match.match_id} (already removed?)`);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`❌ [Archive] Failed for ${match.match_id}: ${err.message}`);
  } finally {
    client.release();
  }
}

// 🕒 CRON — Runs every 15 minutes
cron.schedule("* * * * *", async () => {
  console.log("🕒 [Cron] Checking for completed matches via Cricbuzz API...");

  try {
    const activeMatches = await getPastActiveMatches();

    if (!activeMatches.length) {
      console.log("✅ No active or recent matches found.");
      return;
    }

    for (const match of activeMatches) {
      // 👇 use `id` instead of match.match_id` (from DB alias)
      const matchId = match.match_id || match.id;

      const res = await fetchMatchStatus(matchId);
      if (!res) continue;

      const { status, data: apiData } = res;
      if (!status) continue;

      // ✅ Detect completion both from API + DB flag
      if (
        [
          "complete",
          "completed",
          "finished",
          "abandon",
          "abandoned",
          "cancel",
          "cancelled",
          "no result",
        ].some((s) => status.includes(s)) ||
        (match.status && match.status.toLowerCase() === "completed")
      ) {
        const resultInfo = {
          state: apiData.state,
          short_status: apiData.shortstatus || apiData.short_status || "",
          toss_status: apiData.tossstatus || "",
          winner: apiData.shortstatus?.split(" ")[0] || null,
          series: apiData.seriesname || "",
        };

        await archiveCompletedMatch({
          match_id: matchId,
          team_a: apiData.team1?.teamname || match.team_a,
          team_b: apiData.team2?.teamname || match.team_b,
          start_time: match.start_time,
          venue: apiData.venueinfo?.ground || match.venue,
          toss_info: apiData.tossstatus || match.toss_info,
          result: resultInfo,
        });
      }
    }

    console.log("🏁 [Cron] Completed matches archived successfully.");
  } catch (err) {
    console.error("❌ [Cron] Error during Cricbuzz check:", err.message);
  }
});
