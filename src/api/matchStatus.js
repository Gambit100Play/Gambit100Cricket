// src/api/matchStatus.js
import { fetchFromCricbuzz } from "./cricbuzzApi.js";

/**
 * 🏏 Fetch detailed match info
 */
export async function fetchMatchDetails(matchId) {
  if (!matchId) throw new Error("❌ matchId is required");

  try {
    const data = await fetchFromCricbuzz(`/mcenter/v1/${matchId}`);

    if (!data) {
      console.warn(`⚠️ No data returned for match ${matchId}`);
      return null;
    }

    return {
      matchId: data.matchid,
      state: data.state || "Unknown",
      toss: data.tossstatus || "",
      shortStatus: data.shortstatus || "",
      statusText: data.status || "",
      matchDesc: data.matchdesc || "",
      team1: data.team1?.teamname || "",
      team2: data.team2?.teamname || "",
    };
  } catch (err) {
    console.error(`❌ [matchStatus] Error fetching match ${matchId}: ${err.message}`);
    return null;
  }
}

/**
 * 🧠 Lightweight version for cron & tests
 */
export async function getMatchStatusSummary(matchId) {
  const details = await fetchMatchDetails(matchId);
  if (!details) return { state: "unknown", toss: "" };

  const normalizedState = (details.state || "").toLowerCase();
  const toss = details.toss || "";
  return { state: normalizedState, toss };
}
