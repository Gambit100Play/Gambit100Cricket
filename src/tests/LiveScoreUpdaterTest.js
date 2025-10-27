// src/tests/LiveScoreUpdaterTest.js
import https from "https";
import dotenv from "dotenv";
import { DateTime } from "luxon";

dotenv.config();
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

export async function fetchLiveScoresEveryTwoOvers() {
  console.log(
    `\n🕓 ${DateTime.now().toFormat("dd LLL yyyy, hh:mm a")} - 🏏 Checking 2-over live updates...\n`
  );

  const matchId = "121653"; // 🔒 Hardcoded for testing only
  const path = `/mcenter/v1/${matchId}/overs`;

  console.log(`🔍 Fetching from ${path}...`);

  try {
    const data = await fetchFromCricbuzz(path);
    if (!data) return console.warn("⚠️ No data returned from Cricbuzz.");

    const mini = data?.miniscore;
    const headers = data?.matchheaders;
    if (!mini || !headers) {
      console.warn("⚠️ Unexpected structure — missing miniscore or headers.");
      return;
    }

    const batTeamName =
      mini?.batteamscore?.teamname ||
      headers?.teamdetails?.batteamname ||
      headers?.team2?.teamname ||
      headers?.team1?.teamname ||
      "Unknown Team";

    const runs = mini?.batteamscore?.teamscore ?? mini?.batTeam?.teamScore ?? 0;
    const wkts = mini?.batteamscore?.teamwkts ?? mini?.batTeam?.teamWkts ?? 0;
    const overs = mini?.batteamscore?.overs ?? mini?.overs ?? 0;
    const crr = mini?.crr ?? "-";
    const rrr = mini?.rrr ?? "-";
    const status =
      headers?.status || headers?.custstatus || mini?.custstatus || "—";

    console.log(
      `📊 [${batTeamName}] ${runs}/${wkts} in ${overs} overs | CRR: ${crr} | RRR: ${rrr} | Status: ${status}`
    );
  } catch (err) {
    console.error("❌ fetchLiveScoresEveryTwoOvers error:", err.message);
  }
}

// ✅ Safe fetcher (keep at bottom)
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

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (!data.length) {
          console.warn(`⚠️ Empty response from ${path}`);
          return resolve(null);
        }
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          console.error("❌ JSON parse error:", err.message);
          console.log("🔍 Raw snippet:", data.slice(0, 200));
          resolve(null);
        }
      });
    });
    req.on("error", (err) => {
      console.error("❌ Request error:", err.message);
      resolve(null);
    });
    req.end();
  });
}

// ✅ Export as both named and default (so cron can import correctly)
export default fetchLiveScoresEveryTwoOvers;

// 🚀 Manual test runner
if (process.argv[1].includes("LiveScoreUpdaterTest.js")) {
  console.log("🚀 Manual Test: Running Live Score Updater...\n");
  await fetchLiveScoresEveryTwoOvers();
}
