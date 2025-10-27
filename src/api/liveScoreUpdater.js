// src/api/liveScoreUpdater.js
import cron from "node-cron";
import https from "https";
import dotenv from "dotenv";
import { getPastActiveMatches, query, markMatchesAsLive } from "../db/db.js";

dotenv.config();
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// =======================================================
// 🧠 Generic fetcher for Cricbuzz RapidAPI (with error handling)
// =======================================================
async function fetchFromCricbuzz(path) {
  const options = {
    method: "GET",
    hostname: "cricbuzz-cricket.p.rapidapi.com",
    port: null,
    path,
    headers: {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": "cricbuzz-cricket.p.rapidapi.com",
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 500) return reject(`HTTP ${res.statusCode}`);
        if (res.statusCode === 429) return reject("HTTP 429 (Rate Limit)");
        if (res.statusCode === 404) return reject("HTTP 404 (Not Found)");
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(`JSON Parse Error: ${err.message}`);
        }
      });
    });
    req.on("error", (err) => reject(`Request Error: ${err.message}`));
    req.end();
  });
}

// =======================================================
// 🔁 Fetch and store live scores every 1 minute (Cricbuzz RapidAPI)
// =======================================================
async function fetchLiveScores() {
  console.log("📡 [LiveScore] Checking live matches (Cricbuzz RapidAPI)...");

  // 1️⃣ Promote any matches that have started
  await markMatchesAsLive();

  // 2️⃣ Get all matches that are live or started
  const matches = await getPastActiveMatches();
  const now = new Date();

  const liveMatches = matches.filter((m) => {
    const status = (m.status || "").toLowerCase();
    const startTime = new Date(m.start_time);
    return status.includes("live") || startTime <= now;
  });

  if (liveMatches.length === 0) {
    console.log("ℹ️ [LiveScore] No live matches right now.");
    return;
  }

  console.log(`🎯 [LiveScore] Found ${liveMatches.length} potential live matches.`);

  for (const match of liveMatches) {
    const path = `/mcenter/v1/${match.id}`;
    try {
      const data = await fetchFromCricbuzz(path);
      const info = data?.matchScore;

      if (!info) {
        console.warn(`⚠️ [LiveScore] No score data for ${match.name}`);
        continue;
      }

      // 🏏 Extract innings summary
      const innings = info?.team1Score || info?.team2Score || null;
      if (!innings?.inngs1) {
        console.warn(`⚠️ [LiveScore] Missing innings info for ${match.name}`);
        continue;
      }

      const scoreObj = innings.inngs1;
      const totalScore = scoreObj.runs ?? 0;
      const wickets = scoreObj.wickets ?? 0;
      const overs = scoreObj.overs ?? 0;
      const formattedScore = `${totalScore}/${wickets} in ${overs} overs`;

      // 🪙 Toss details (if available)
      const tossText = data?.matchInfo?.tossResults
        ? `${data.matchInfo.tossResults.tossWinnerName} won the toss and chose to ${data.matchInfo.tossResults.decision} first`
        : "Toss not yet done";

      // 🗃️ Insert into live_scores table
      await query(
        `
        INSERT INTO live_scores
          (match_id, over_number, runs, wickets, fours, sixes, total_score, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (match_id, over_number) DO NOTHING;
        `,
        [
          match.id,
          Math.floor(overs),
          totalScore,
          wickets,
          scoreObj.fours ?? 0,
          scoreObj.sixes ?? 0,
          formattedScore,
          JSON.stringify(info),
        ]
      );

      console.log(`✅ [LiveScore] Updated ${match.name}: ${formattedScore}`);
      console.log(`🪙 Toss Info: ${tossText}`);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("HTTP 500")) {
        console.warn(`⚠️ [LiveScore] HTTP 500 for ${match.id} — skipping this cycle.`);
      } else if (msg.includes("HTTP 404")) {
        console.warn(`⚠️ [LiveScore] Match ${match.id} not found — marking completed.`);
        await query(`UPDATE matches SET status='completed' WHERE id=$1`, [match.id]);
      } else if (msg.includes("429")) {
        console.warn("⚠️ [LiveScore] Rate limit hit — pausing updates temporarily.");
      } else {
        console.error(`❌ [LiveScore] Failed for ${match.id}:`, msg);
      }
    }
  }
}

// =======================================================
// ⏰ Schedule the Cron (every 1 minute)
// =======================================================
cron.schedule("0 6/18 * * *", fetchLiveScores, {
  timezone: "Asia/Kolkata",
});

export default fetchLiveScores;
