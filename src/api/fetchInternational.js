// src/api/fetchInternational.js
import axios from "axios";
import { DateTime } from "luxon";
import { logger as customLogger } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config(); // ensure .env is loaded before reading RAPIDAPI_KEY

const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const HOST = "cricbuzz-cricket2.p.rapidapi.com";
const logger = customLogger || console;

/**
 * ✅ Fetches all upcoming/live International matches from Cricbuzz via RapidAPI.
 * Handles ads, missing states, and normalizes match structure.
 */
export async function fetchInternationalMatches() {
  const lastTime = "1729555200000";
  const url = `https://${HOST}/schedule/v1/International`;

  if (!RAPID_API_KEY) {
    logger.error("🚨 [International] Missing RAPIDAPI_KEY in environment.");
    return [];
  }

  try {
    logger.info(`📡 [International] Fetching: ${url}?lastTime=${lastTime}`);

    const { data } = await axios.get(url, {
      params: { lastTime },
      headers: {
        "x-rapidapi-key": RAPID_API_KEY,
        "x-rapidapi-host": HOST,
      },
      timeout: 20000,
    });

    // ✅ Expected structure: { matchScheduleMap: [...], appIndex: {...} }
    const scheduleMaps = data?.matchScheduleMap || [];

    if (!Array.isArray(scheduleMaps) || scheduleMaps.length === 0) {
      logger.warn("⚠️ [International] No matchScheduleMap found in response.");
      console.log("🔑 Top-level keys:", Object.keys(data || {}));
      return [];
    }

    const matches = parseSchedule(scheduleMaps);

    if (matches.length > 0) {
      logger.info(`🌍 [International] Parsed ${matches.length} matches successfully.`);
      console.log("🩵 Sample:", matches.slice(0, 3));
    } else {
      logger.warn("⚠️ [International] Parsed 0 matches (check filtering logic).");
    }

    return matches;
  } catch (err) {
    const msg = err.response
      ? `Request failed with status ${err.response.status}: ${err.response.statusText}`
      : err.message || JSON.stringify(err);

    logger.error(`🚨 [International] Fetch error: ${msg}`);
    console.error("🚨 [International] Full error object:", err.toJSON?.() || err);
    return [];
  }
}

/**
 * 🔍 Flattens and normalizes match schedule data.
 * Works even if 'state' is missing (common for upcoming matches).
 */
function parseSchedule(scheduleMaps) {
  const matches = [];

  for (const entry of scheduleMaps) {
    const wrapper = entry?.scheduleAdWrapper;
    if (!wrapper?.matchScheduleList) continue; // skip adDetail entries

    for (const series of wrapper.matchScheduleList) {
      const seriesName = series.seriesName || "Unknown Series";

      for (const match of series.matchInfo || []) {
        // 🧠 Default state if missing
        const rawState = match?.state ? String(match.state).toLowerCase() : "upcoming";
        const state = normalizeState(rawState);

        matches.push({
          match_id: match.matchId,
          series_id: match.seriesId,
          series_name: seriesName,
          match_desc: match.matchDesc,
          match_format: match.matchFormat,
          start_date: DateTime.fromMillis(Number(match.startDate))
            .setZone("Asia/Kolkata")
            .toISO(),
          end_date: DateTime.fromMillis(Number(match.endDate))
            .setZone("Asia/Kolkata")
            .toISO(),
          team1: match.team1?.teamName ?? "TBD",
          team2: match.team2?.teamName ?? "TBD",
          venue: match.venueInfo?.ground ?? "Unknown Ground",
          city: match.venueInfo?.city ?? "",
          country: match.venueInfo?.country ?? "",
          timezone: match.venueInfo?.timezone ?? "+05:30",
          status: state,
        });
      }
    }
  }

  console.log("🧠 [Debug] Matches parsed:", matches.length);
  return matches;
}

/**
 * 🎯 Normalizes Cricbuzz states; defaults to 'upcoming' if missing.
 */
function normalizeState(raw) {
  if (!raw) return "upcoming";
  const state = raw.toLowerCase();

  if (["preview", "scheduled", "start delay", "upcoming"].includes(state))
    return "upcoming";
  if (["in progress", "live", "innings break", "lunch", "tea"].includes(state))
    return "live";

  return "completed";
}
