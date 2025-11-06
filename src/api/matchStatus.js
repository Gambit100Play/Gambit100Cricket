// src/api/matchStatus.js
import axios from "axios";

/* ============================================================
 ⚡ Cricbuzz API Client (via RapidAPI)
============================================================ */
async function fetchFromCricbuzz(matchId) {
  const url = `https://cricbuzz-cricket2.p.rapidapi.com/mcenter/v1/${matchId}`;
  console.info(`[fetchFromCricbuzz] 🌐 Request → ${url}`);

  try {
    const start = Date.now();
    const response = await axios.get(url, {
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
      },
      timeout: 15000,
    });

    const ms = Date.now() - start;
    console.info(
      `[fetchFromCricbuzz] ✅ Received match=${matchId} (${ms} ms, ${JSON.stringify(
        response.data?.matchHeader?.state || "no state"
      )})`
    );
    return response.data;
  } catch (err) {
    console.error(
      `[fetchFromCricbuzz] ❌ Failed for match=${matchId}: ${err.message}`
    );
    if (err.response) {
      console.error(
        `[fetchFromCricbuzz] ↳ Status=${err.response.status} | Data=${JSON.stringify(
          err.response.data
        )}`
      );
    }
    return null;
  }
}

/* ============================================================
 🏏 fetchMatchDetails(matchId)
 Returns structured match info (state, toss, overs, etc.)
============================================================ */
export async function fetchMatchDetails(matchId) {
  if (!matchId) throw new Error("❌ matchId is required");

  console.info(`[matchStatus] 🏏 Fetching details for matchId=${matchId}`);

  try {
    const data = await fetchFromCricbuzz(matchId);
    if (!data) {
      console.warn(`[matchStatus] ⚠️ No data for matchId=${matchId}`);
      return null;
    }

    // Defensive parsing
    const header = data.matchHeader || {};
    const liveSummary = data.liveSummary || data.liveScore || {};

    const rawState = header.state || data.state || "Unknown";
    const rawToss =
      header.tossResults?.tossWinnerName && header.tossResults?.decision
        ? `${header.tossResults.tossWinnerName} opt to ${header.tossResults.decision}`
        : data.tossstatus || "";

    const team1 = header.team1?.name || data.team1?.teamName || "";
    const team2 = header.team2?.name || data.team2?.teamName || "";
    const innings = Number(liveSummary?.inningsId || 0);
    const overs = Number(liveSummary?.overs || 0);

    // Normalize paused “in progress” states
    const pausedStates = [
      "stumps",
      "tea",
      "lunch",
      "innings break",
      "drinks",
      "in progress",
    ];
    const state = pausedStates.includes(rawState.toLowerCase())
      ? "In Progress"
      : rawState;

    const resultText =
      header.result?.result ||
      data.shortstatus ||
      data.statusText ||
      header.status ||
      "";

    console.debug(
      `[matchStatus] 📊 Parsed matchId=${matchId} | state=${state} | toss='${rawToss}' | overs=${overs} | innings=${innings}`
    );

    if (process.env.DEBUG_MATCH_STATUS === "true") {
      console.debug(
        `[matchStatus:debug] headerKeys=${Object.keys(header)} | liveSummaryKeys=${Object.keys(
          liveSummary
        )}`
      );
    }

    return {
      matchId,
      state,
      toss: rawToss,
      shortStatus: data.shortstatus || "",
      resultText,
      matchDesc: header.matchDescription || data.matchdesc || "",
      team1,
      team2,
      innings,
      overs,
      winner: header.winnerTeam || header.matchResult || "",
    };
  } catch (err) {
    console.error(
      `[matchStatus] ❌ fetchMatchDetails failed for ${matchId}: ${err.message}`
    );
    return null;
  }
}

/* ============================================================
 🧠 getMatchStatusSummary(matchId)
 Lightweight wrapper for crons, tests, and locks
============================================================ */
export async function getMatchStatusSummary(matchId) {
  console.info(`[matchStatus] 🔍 Summarizing matchId=${matchId}`);

  const details = await fetchMatchDetails(matchId);
  if (!details) {
    console.warn(`[matchStatus] ⚠️ No details found for matchId=${matchId}`);
    return {
      state: "unknown",
      toss: "",
      overs: 0,
      innings: 0,
      winner: "",
      runs: 0,
      wickets: 0,
      boundaries: 0,
    };
  }

  const normalizedState = (details.state || "unknown").toLowerCase();

  // Extract rough indicators from match score string (optional fallback)
  let runs = 0,
    wickets = 0,
    boundaries = 0;
  try {
    const scoreMatch = (details.resultText || "")
      .match(/(\d+)\/(\d+)/); // like "120/3"
    if (scoreMatch) {
      runs = Number(scoreMatch[1]);
      wickets = Number(scoreMatch[2]);
    }
  } catch {}

  const summary = {
    state: normalizedState,
    toss: details.toss || "",
    overs: Number(details.overs || 0),
    innings: Number(details.innings || 0),
    winner: details.winner || "",
    team1: details.team1,
    team2: details.team2,
    runs,
    wickets,
    boundaries,
  };

  console.info(
    `[matchStatus] ✅ Summary matchId=${matchId} | state=${summary.state} | toss='${summary.toss}' | overs=${summary.overs} | innings=${summary.innings}`
  );

  if (summary.runs || summary.wickets) {
    console.debug(
      `[matchStatus] 🧾 Score snapshot → runs=${summary.runs}, wickets=${summary.wickets}, boundaries=${summary.boundaries}`
    );
  }

  return summary;
}
