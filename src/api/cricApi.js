// cricpredict-bot/src/api/cricApi.js

process.env.TZ = "UTC";

import fetch from "node-fetch";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import {
  saveMatch,
  deleteExpiredMatches
} from "../db/db.js";

dotenv.config();

const CRICAPI_KEY = process.env.CRICAPI_KEY;

// ⚙️ Helper — detailed status check for grey-zone matches
async function fetchMatchInfo(matchId) {
  const url = `https://api.cricapi.com/v1/match_info?apikey=${CRICAPI_KEY}&id=${matchId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.data || null;
  } catch (err) {
    console.error(`❌ [CricAPI] match_info failed (${matchId}):`, err.message);
    return null;
  }
}

// ✅ Fetch & store matches (live / upcoming / completed)
export async function fetchMatches() {
  console.log("🌐 [CricAPI] Starting match fetch...");

  const url = `https://api.cricapi.com/v1/matches?apikey=${CRICAPI_KEY}`;
  let res;

  try {
    res = await fetch(url);
  } catch (err) {
    console.error("❌ [CricAPI] Network error:", err.message);
    return [];
  }

  if (!res.ok) {
    console.error("❌ [CricAPI] Bad response:", res.status, res.statusText);
    return [];
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error("❌ [CricAPI] JSON parse error:", err.message);
    return [];
  }

  if (!data?.data) {
    console.error("❌ [CricAPI] No valid data returned:", data);
    return [];
  }

  console.log(`📊 [CricAPI] Received ${data.data.length} total matches.`);

  const nowUTC = DateTime.utc();
  let saved = 0;

  for (const m of data.data) {
    const rawStatus = (m.status || "").toLowerCase();
    const matchId = String(m.id).trim();

    // 🕒 Parse UTC start time
    let matchTimeUTC = null;
    if (m.dateTimeGMT) {
      matchTimeUTC = m.dateTimeGMT.includes("T")
        ? DateTime.fromISO(m.dateTimeGMT, { zone: "utc" })
        : DateTime.fromSQL(m.dateTimeGMT, { zone: "utc" });
    }

    // 🕒 Convert UTC → IST (+5h 30m)
    let matchTimeIST = null;
    let startDateIST = null;
    let startTimeLocalIST = null;

    if (matchTimeUTC?.isValid) {
      matchTimeIST = matchTimeUTC.setZone("Asia/Kolkata");
      startDateIST = matchTimeIST.toFormat("yyyy-LL-dd");   // e.g. 2025-10-24
      startTimeLocalIST = matchTimeIST.toFormat("HH:mm:ss"); // e.g. 10:30:00
    }

    // Compute hours since start (in UTC, safe for "old match" detection)
    let hoursSinceStart = null;
    if (matchTimeUTC) hoursSinceStart = nowUTC.diff(matchTimeUTC, "hours").hours;

    // Check completion status
    const isCompletedByStatus = [
      "won", "lost", "tied", "draw", "abandoned", "cancelled",
      "ended", "completed", "no result"
    ].some(kw => rawStatus.includes(kw));

    // Check if too old (started more than 6h ago)
    const isOldMatch = hoursSinceStart !== null && hoursSinceStart > 6;

    // Determine final status
    let status = "upcoming";
    if (isCompletedByStatus || isOldMatch) {
      status = "completed";
    } else if (["live", "in progress", "playing"].some(kw => rawStatus.includes(kw))) {
      status = "live";
    } else if (["scheduled", "upcoming", "fixture", "not started"].some(kw => rawStatus.includes(kw))) {
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

    // 🧩 Build match object (includes both UTC + IST fields)
    const match = {
      id: matchId,
      name: `${m.teams?.[0] || "Team A"} vs ${m.teams?.[1] || "Team B"}`,
      start_time: m.dateTimeGMT, // original UTC
      start_date: startDateIST,  // derived local date
      start_time_local: startTimeLocalIST, // derived local time
      status,
      score: m.score || null,
      api_payload: m,
    };

    try {
      await saveMatch(match);
      console.log(`💾 [DB] Saved: ${match.name} (${status}) [${startDateIST} ${startTimeLocalIST} IST]`);
      saved++;
    } catch (err) {
      console.error("❌ [DB] Save failed:", match.name, "-", err.message);
    }
  }

  // 🧹 Clean up expired matches
  await deleteExpiredMatches();

  console.log(`✅ [CricAPI] Saved ${saved} matches (live, upcoming & completed).`);
  console.log("─────────────────────────────────────────────\n");
  return saved;
}

export { fetchMatchInfo };
