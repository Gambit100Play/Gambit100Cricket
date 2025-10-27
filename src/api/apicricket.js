// cricpredict-bot/src/api/apiCricket.js

process.env.TZ = "UTC";

import fetch from "node-fetch";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import {
  saveMatch,
  deleteExpiredMatches
} from "../db/db.js";

dotenv.config();

const APICRICKET_KEY = process.env.APICRICKET_KEY;

// 🧩 Helper — detailed status check for matches stuck in "Scheduled" state
async function fetchMatchInfo(matchId) {
  const url = `https://api.api-cricket.com/cricket/match/${matchId}?apikey=${APICRICKET_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.result || null;
  } catch (err) {
    console.error(`❌ [API Cricket] match_info failed (${matchId}):`, err.message);
    return null;
  }
}

// ✅ Fetch & store all live + upcoming + recent matches
export async function fetchMatches() {
  console.log("🌐 [API Cricket] Starting match fetch...");

  const url = `https://api.api-cricket.com/cricket/matches?apikey=${APICRICKET_KEY}`;
  let res;

  try {
    res = await fetch(url);
  } catch (err) {
    console.error("❌ [API Cricket] Network error:", err.message);
    return [];
  }

  if (!res.ok) {
    console.error("❌ [API Cricket] Bad response:", res.status, res.statusText);
    return [];
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error("❌ [API Cricket] JSON parse error:", err.message);
    return [];
  }

  if (!data?.result || !Array.isArray(data.result)) {
    console.error("❌ [API Cricket] No valid match data returned:", data);
    return [];
  }

  console.log(`📊 [API Cricket] Received ${data.result.length} total matches.`);

  const nowUTC = DateTime.utc();
  let saved = 0;

  for (const m of data.result) {
    const rawStatus = (m.status || "").toLowerCase();
    const matchId = String(m.id || m.match_id || "").trim();
    if (!matchId) continue;

    // 🕒 Parse UTC start time
    let matchTimeUTC = null;
    if (m.starting_at) {
      matchTimeUTC = DateTime.fromISO(m.starting_at, { zone: "utc" });
    }

    // 🕒 Convert UTC → IST (+5:30)
    let matchTimeIST = null;
    let startDateIST = null;
    let startTimeLocalIST = null;
    if (matchTimeUTC?.isValid) {
      matchTimeIST = matchTimeUTC.setZone("Asia/Kolkata");
      startDateIST = matchTimeIST.toFormat("yyyy-LL-dd");
      startTimeLocalIST = matchTimeIST.toFormat("HH:mm:ss");
    }

    // Compute hours since scheduled start
    let hoursSinceStart = null;
    if (matchTimeUTC) hoursSinceStart = nowUTC.diff(matchTimeUTC, "hours").hours;

    // Check completion status
    const isCompletedByStatus = [
      "finished", "ended", "result", "won", "lost", "draw", "no result"
    ].some(kw => rawStatus.includes(kw));

    // Check if too old (6h rule)
    const isOldMatch = hoursSinceStart !== null && hoursSinceStart > 6;

    // Determine final status
    let status = "upcoming";
    if (isCompletedByStatus || isOldMatch) {
      status = "completed";
    } else if (["live", "in progress", "playing"].some(kw => rawStatus.includes(kw))) {
      status = "live";
    } else if (["scheduled", "fixture", "not started", "upcoming"].some(kw => rawStatus.includes(kw))) {
      status = "upcoming";
    } else {
      // grey zone: check via match_info
      if (hoursSinceStart && hoursSinceStart >= 4 && hoursSinceStart <= 6) {
        const detailed = await fetchMatchInfo(matchId);
        const detailStatus = detailed?.status?.toLowerCase() || "";
        if (["live", "in progress", "playing"].some(kw => detailStatus.includes(kw))) {
          status = "live";
        } else {
          status = "completed";
        }
      }
    }

    // 🪙 Include toss info if available
    const tossInfo =
      m.toss_won_team && m.elected
        ? `${m.toss_won_team} won the toss and chose to ${m.elected.toLowerCase()} first`
        : null;

    // 🧩 Build match object
    const match = {
      id: matchId,
      name: `${m.localteam?.name || "Team A"} vs ${m.visitorteam?.name || "Team B"}`,
      start_time: m.starting_at, // UTC ISO
      start_date: startDateIST,
      start_time_local: startTimeLocalIST,
      status,
      score: m.runs || null,
      toss_info: tossInfo,
      api_payload: m,
    };

    try {
      await saveMatch(match);
      console.log(
        `💾 [DB] Saved: ${match.name} (${status}) [${startDateIST} ${startTimeLocalIST} IST]`
      );
      saved++;
    } catch (err) {
      console.error("❌ [DB] Save failed:", match.name, "-", err.message);
    }
  }

  // 🧹 Clean up expired matches
  await deleteExpiredMatches();

  console.log(`✅ [API Cricket] Saved ${saved} matches (live, upcoming & completed).`);
  console.log("─────────────────────────────────────────────\n");
  return saved;
}

export { fetchMatchInfo };
