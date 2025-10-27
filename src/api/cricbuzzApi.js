import https from "https";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import { saveMatch, deleteExpiredMatches } from "../db/db.js";

dotenv.config();
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// ===========================================================
// 🧠 Generic HTTPS fetch wrapper for Cricbuzz RapidAPI
// ===========================================================
async function fetchFromCricbuzz(path) {
  const options = {
    method: "GET",
    hostname: "cricbuzz-cricket.p.rapidapi.com",
    path,
    headers: {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": "cricbuzz-cricket.p.rapidapi.com",
    },
  };

  console.log(`⇢ [Cricbuzz] Fetching: ${path}`);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const duration = Date.now() - start;

        if (res.statusCode >= 500) return reject(`HTTP ${res.statusCode} (Server Error)`);
        if (res.statusCode === 429) return reject("HTTP 429 (Rate Limit Exceeded)");
        if (res.statusCode >= 400) return reject(`HTTP ${res.statusCode} (Client Error)`);

        try {
          const json = JSON.parse(data);
          console.log(`⇠ [Cricbuzz] OK (${res.statusCode}) in ${duration}ms`);
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

// ===========================================================
// 🧩 Match status normalization (handles all states & variations)
// ===========================================================
function getNormalizedStatus(match) {
  const stateFields = [
    match.stateTitle,
    match.state,
    match.status,
    match.shortstatus,
  ];
  const rawState = stateFields.filter(Boolean).join(" ").toLowerCase();

  // 🟢 LIVE
  if (
    rawState.includes("live") ||
    rawState.includes("in progress") ||
    rawState.includes("playing") ||
    rawState.includes("toss")
  ) {
    return { status: "live", rawState };
  }

  // 🔴 COMPLETED
  if (
    rawState.includes("complete") ||
    rawState.includes("completed") ||
    rawState.includes("finished") ||
    rawState.includes("won") ||
    rawState.includes("lost") ||
    rawState.includes("draw") ||
    rawState.includes("abandoned") ||
    rawState.includes("cancelled") ||
    rawState.includes("no result") ||
    rawState.includes("stumps")
  ) {
    return { status: "completed", rawState };
  }

  // 🟡 UPCOMING
  return { status: "upcoming", rawState };
}

// ===========================================================
// 🌍 Fetch & Store Only Active (Live + Upcoming) Matches
// ===========================================================
export async function fetchMatchesFromCricbuzz() {
  console.log("🌐 [Cricbuzz] Fetching active (live + upcoming) matches...");

  try {
    const [liveData, upcomingData] = await Promise.allSettled([
      fetchFromCricbuzz("/matches/v1/live"),
      fetchFromCricbuzz("/matches/v1/upcoming"),
    ]);

    const matchesToSave = [];
    const seen = new Set();
    let saved = 0;

    const processMatches = (matches, label) => {
      for (const m of matches || []) {
        const match = m.matchInfo;
        if (!match?.matchId) return;

        const id = String(match.matchId);
        if (seen.has(id)) return;
        seen.add(id);

        // 🔍 Classify status correctly
        const { status, rawState } = getNormalizedStatus(match);

        // 🚫 Skip completed ones (even if API is “live”)
        if (status === "completed") {
          console.log(`⏭️ [Skip] ${match.seriesName} - ${match.matchDesc} (${rawState})`);
          return;
        }

        const teamA = match.team1?.teamName || "Team A";
        const teamB = match.team2?.teamName || "Team B";
        const matchName = `${teamA} vs ${teamB}`;

        const startTime = match.startDate ? new Date(Number(match.startDate)) : null;
        const dtIST = startTime
          ? DateTime.fromJSDate(startTime).setZone("Asia/Kolkata")
          : null;

        const tossWinner = match?.tossResults?.tossWinnerName;
        const tossDecision = match?.tossResults?.decision;
        const tossInfo =
          tossWinner && tossDecision
            ? `${tossWinner} won the toss and chose to ${tossDecision} first`
            : null;

        matchesToSave.push({
          id,
          name: matchName,
          start_time: startTime?.toISOString() || null,
          start_date: dtIST?.toFormat("yyyy-LL-dd") || null,
          start_time_local: dtIST?.toFormat("HH:mm:ss") || null,
          status, // ✅ uses normalized status
          toss_info: tossInfo,
          api_payload: match,
        });
      }
      console.log(`📊 [Cricbuzz] Processed ${matches.length} matches from ${label}`);
    };

    // LIVE
    if (liveData.status === "fulfilled" && liveData.value?.typeMatches) {
      for (const type of liveData.value.typeMatches) {
        for (const series of type.seriesMatches || []) {
          processMatches(series.seriesAdWrapper?.matches || [], "LIVE");
        }
      }
    }

    // UPCOMING
    if (upcomingData.status === "fulfilled" && upcomingData.value?.typeMatches) {
      for (const type of upcomingData.value.typeMatches) {
        for (const series of type.seriesMatches || []) {
          processMatches(series.seriesAdWrapper?.matches || [], "UPCOMING");
        }
      }
    }

    // 💾 Save valid matches
    for (const matchObj of matchesToSave) {
      try {
        await saveMatch(matchObj);
        saved++;
        console.log(`💾 [DB] Saved: ${matchObj.name} (${matchObj.status})`);
      } catch (err) {
        console.warn(`⚠️ [DB] Save failed for ${matchObj.name}: ${err.message}`);
      }
    }

    await deleteExpiredMatches();
    console.log(`✅ [Cricbuzz] Saved ${saved} matches (live/scheduled only).`);
    console.log("─────────────────────────────────────────────\n");
    return saved;
  } catch (err) {
    console.error("❌ [Cricbuzz] Fetch error:", err);
    if (String(err).includes("429")) console.warn("⚠️ Rate limit hit — try again later.\n");
    return [];
  }
}

export default fetchMatchesFromCricbuzz;
