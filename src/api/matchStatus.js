// ============================================================
// 🏏 Cricbuzz Match Status Module (v3.0 — Unified Parser)
// ============================================================
//
// Handles both active/live and archived Cricbuzz match responses
// via RapidAPI, automatically normalizing fields for crons.
//
// Works for endpoints returning either:
//   { matchHeader: {...}, liveSummary: {...} }  ← active
//   or
//   { matchid, team1, team2, state, tossstatus } ← completed
// ============================================================

import axios from "axios";

/* ============================================================
 ⚡ Cricbuzz API Client (with auto-fallback between hosts)
============================================================ */
async function fetchFromCricbuzz(matchId) {
  if (!matchId) throw new Error("❌ matchId is required");

  const hosts = [
    "cricbuzz-cricket2.p.rapidapi.com",
    "cricbuzz-cricket.p.rapidapi.com"
  ];

  for (const host of hosts) {
    const url = `https://${host}/mcenter/v1/${matchId}`;
    console.info(`[fetchFromCricbuzz] 🌐 Request → ${url}`);
    try {
      const start = Date.now();
      const response = await axios.get(url, {
        headers: {
          "x-rapidapi-key": process.env.RAPIDAPI_KEY,
          "x-rapidapi-host": host,
        },
        timeout: 15000,
      });
      const ms = Date.now() - start;
      const state = response.data?.matchHeader?.state || response.data?.state || "no state";
      console.info(`[fetchFromCricbuzz] ✅ ${host} responded (${ms} ms) → state="${state}"`);
      return response.data;
    } catch (err) {
      console.warn(`[fetchFromCricbuzz] ⚠️ ${host} failed for match=${matchId}: ${err.message}`);
    }
  }

  console.error(`[fetchFromCricbuzz] ❌ Both hosts failed for match=${matchId}`);
  return null;
}

/* ============================================================
 🏏 fetchMatchDetails(matchId)
 Returns normalized structured match info
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

    // 🧩 Detect response type
    const isMcenter = !!data.matchHeader;
    const header = isMcenter ? data.matchHeader : {};
    const liveSummary = data.liveSummary || data.liveScore || {};

    // Extract core fields safely
    const rawState = (isMcenter ? header.state : data.state) || "Unknown";
    const rawToss = isMcenter
      ? (header.tossResults?.tossWinnerName && header.tossResults?.decision
          ? `${header.tossResults.tossWinnerName} opt to ${header.tossResults.decision}`
          : data.tossstatus || "")
      : data.tossstatus || "";

    const team1 = isMcenter
      ? header.team1?.name || ""
      : data.team1?.teamname || data.team1?.teamName || "";
    const team2 = isMcenter
      ? header.team2?.name || ""
      : data.team2?.teamname || data.team2?.teamName || "";

    const innings = Number(liveSummary?.inningsId || 0);
    const overs = Number(liveSummary?.overs || 0);

    // Normalize states
    const normalized = rawState.toLowerCase();
    let state = "Unknown";
    if (["stumps", "tea", "lunch", "innings break", "drinks", "in progress"].includes(normalized)) {
      state = "In Progress";
    } else if (["complete", "completed"].includes(normalized)) {
      state = "Completed";
    } else if (["upcoming", "preview", "scheduled"].includes(normalized)) {
      state = "Upcoming";
    } else if (["toss", "toss delayed"].includes(normalized) || rawToss.toLowerCase().includes("opt to")) {
      state = "Toss";
    } else {
      state = rawState;
    }

    const resultText =
      header.result?.result ||
      data.shortstatus ||
      data.statusText ||
      data.status ||
      header.status ||
      "";

    // Winner extraction fallback
    const winner =
      header.winnerTeam ||
      header.matchResult ||
      (resultText.includes("won") ? resultText.split(" won")[0] : "");

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
      winner,
    };
  } catch (err) {
    console.error(`[matchStatus] ❌ fetchMatchDetails failed for ${matchId}: ${err.message}`);
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

  // Rough run/wicket extraction for quick logs
  let runs = 0, wickets = 0, boundaries = 0;
  try {
    const scoreMatch = (details.resultText || "").match(/(\d+)\/(\d+)/);
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
