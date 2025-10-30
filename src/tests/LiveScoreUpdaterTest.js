// src/tests/LiveScoreUpdaterTest.js
import https from "https";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import { query } from "../db/db.js";

dotenv.config();
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

/**
 * Fetch and display (or update DB) the live “overs” data for a specific match ID.
 * Uses actual Cricbuzz structure verified from API.
 */
export default async function fetchLiveScoresEveryTwoOvers(matchId) {
  if (!matchId) throw new Error("❌ No matchId provided");

  const now = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`\n🕓 ${now} - 🏏 Fetching live 2-over update for Match ID: ${matchId}`);

  const path = `/mcenter/v1/${matchId}/overs`;

  try {
    const data = await fetchFromCricbuzz(path);
    if (!data || !data.miniscore) {
      console.warn(`⚠️ No miniscore data for match ${matchId}.`);
      return;
    }

    const mini = data.miniscore;
    const head = data.matchheaders || {};

    // ===============================
    // 🧩 Extract Core Fields
    // ===============================
    const batTeam = head.teamdetails?.batteamname || "Unknown Team";
    const bowlTeam = head.teamdetails?.bowlteamname || "Unknown Opponent";
    const format = head.matchformat || "Unknown Format";

    const runs = mini.batteamscore?.teamscore ?? 0;
    const wkts = mini.batteamscore?.teamwkts ?? 0;
    const overs = mini.inningsscores?.inningsscore?.[0]?.overs ?? 0;
    const crr = mini.crr ?? "-";
    const rrr = mini.rrr ?? "-";
    const status = head.status || mini.custstatus || "—";

    // 🎯 Striker / Non-Striker / Bowler
    const striker = mini.batsmanstriker?.name || "—";
    const strikerRuns = mini.batsmanstriker?.runs || 0;
    const strikerBalls = mini.batsmanstriker?.balls || 0;

    const nonStriker = mini.batsmannonstriker?.name || "—";
    const nonStrikerRuns = mini.batsmannonstriker?.runs || 0;
    const nonStrikerBalls = mini.batsmannonstriker?.balls || 0;

    const bowler = mini.bowlerstriker?.name || "—";
    const bowlerWkts = mini.bowlerstriker?.wickets || 0;
    const bowlerRuns = mini.bowlerstriker?.runs || 0;
    const bowlerOvers = mini.bowlerstriker?.overs || "0";

    // 🕒 Recent Overs — 2 latest
    const oversList = data.overseplist?.oversep || [];
    const recentOvers = oversList.slice(0, 2);
    const recentSummary = recentOvers
      .map(
        (o) =>
          `Over ${o.overnum}: ${o.oversummary.trim()} | Runs: ${o.runs}, Wkts: ${o.wickets}`
      )
      .join(" || ");

    // ===============================
    // 🧾 Build Final Summary
    // ===============================
    const summary = `[${batTeam}] ${runs}/${wkts} in ${overs} overs | CRR: ${crr} | RRR: ${rrr}`;

    console.log(`📊 ${summary}`);
    console.log(`🏏 Format: ${format}`);
    console.log(`👥 Batting: ${striker} (${strikerRuns} off ${strikerBalls}) & ${nonStriker} (${nonStrikerRuns} off ${nonStrikerBalls})`);
    console.log(`🎯 Bowling: ${bowler} - ${bowlerWkts}/${bowlerRuns} in ${bowlerOvers} ov`);
    if (recentSummary) console.log(`🕒 Last 2 Overs → ${recentSummary}`);
    console.log(`🧾 Status: ${status}`);
    console.log("──────────────────────────────────────────────");

    // =========================================================
    // 💾 Database update (only if data is valid)
    // =========================================================
    if (runs === 0 && wkts === 0 && overs === 0) {
      console.log("ℹ️ [DB] Skipped update — innings not started yet.");
      return;
    }

    await query(
      `UPDATE matches
       SET score = $2, status = $3, updated_at = NOW()
       WHERE id = $1`,
      [matchId, summary, "live"]
    );
    console.log(`✅ [DB] Match ${matchId} updated successfully.`);
  } catch (err) {
    console.error(`❌ [LiveScoreUpdater] Error for ${matchId}:`, err.message);
  }
}

// =============================================================
// 🔒 Safe HTTPS fetcher
// =============================================================
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
          resolve(JSON.parse(data));
        } catch (err) {
          console.error("❌ JSON parse error:", err.message);
          console.log("🔍 Snippet:", data.slice(0, 400));
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

// =============================================================
// 🚀 Manual Test Runner (ESM safe)
// =============================================================
import { fileURLToPath } from "url";
import { basename } from "path";
const __filename = fileURLToPath(import.meta.url);

if (basename(__filename) === "LiveScoreUpdaterTest.js") {
  console.log("🚀 Manual Test: Running Live Score Updater...\n");
  await fetchLiveScoresEveryTwoOvers("135255"); // ✅ Example: UAE vs USA
}
