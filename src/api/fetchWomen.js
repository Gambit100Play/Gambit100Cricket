// src/api/fetchWomen.js
import axios from "axios";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import { logger as customLogger } from "../utils/logger.js";

dotenv.config();

const HOST = "cricbuzz-cricket2.p.rapidapi.com";
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const logger = customLogger || console;

/**
 * 👩‍🦰 Fetches Women's Cricket match schedules via Cricbuzz RapidAPI.
 * Uses a fixed `lastTime` cursor for stable pagination and consistent results.
 */
export async function fetchWomenMatches() {
  const lastTime = "1729641600000"; // static cursor that guarantees valid upcoming fixtures
  const url = `https://${HOST}/schedule/v1/women`;

  if (!RAPID_API_KEY) {
    logger.error("🚨 [Women] Missing RAPIDAPI_KEY in environment.");
    return [];
  }

  const options = {
    method: "GET",
    url,
    params: { lastTime },
    headers: {
      "x-rapidapi-key": RAPID_API_KEY,
      "x-rapidapi-host": HOST,
    },
    timeout: 20000,
  };

  try {
    logger.info(`📡 [Women] Fetching: ${url}?lastTime=${lastTime}`);

    const response = await axios.request(options);
    const data = response.data;

    // ✅ Expecting { matchScheduleMap: [...], appIndex: {...} }
    if (!data || !data.matchScheduleMap) {
      logger.warn("⚠️ [Women] Empty or malformed API response.");
      logger.debug?.(`🔑 Top-level keys: ${Object.keys(data || {})}`);
      return [];
    }

    const matches = parseSchedule(data.matchScheduleMap, "👩‍🦰 Women");

    if (matches.length > 0) {
      logger.info(`👩‍🦰 [Women] Parsed ${matches.length} matches successfully.`);
      console.log("🩷 Sample:", matches.slice(0, 3));
    } else {
      logger.warn("⚠️ [Women] Parsed 0 matches (check filtering logic or fixtures availability).");
    }

    return matches;
  } catch (error) {
    const msg = error.response
      ? `Request failed with status ${error.response.status}: ${error.response.statusText}`
      : error.message || JSON.stringify(error);

    logger.error(`🚨 [Women] Fetch error: ${msg}`);
    console.error("🚨 [Women] Full error object:", error.toJSON?.() || error);
    return [];
  }
}

/**
 * 🔍 Extracts and flattens the schedule structure into normalized match objects.
 */
function parseSchedule(scheduleMaps, label) {
  const matches = [];

  for (const entry of scheduleMaps) {
    const wrapper = entry?.scheduleAdWrapper;
    if (!wrapper?.matchScheduleList) continue; // skip ad blocks

    for (const series of wrapper.matchScheduleList) {
      const seriesName = series.seriesName || "Unknown Series";

      for (const match of series.matchInfo || []) {
        const rawState = match?.state ? String(match.state).toLowerCase() : "upcoming";
        const state = normalizeState(rawState);

        if (!["upcoming", "live"].includes(state)) continue;

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

  logger.info(`${label}: ${matches.length} matches found`);
  return matches;
}

/**
 * 🎯 Normalizes Cricbuzz match states into categories.
 */
function normalizeState(state) {
  if (!state) return "upcoming";
  if (["preview", "upcoming", "scheduled", "start delay"].includes(state))
    return "upcoming";
  if (["in progress", "live", "innings break", "lunch", "tea"].includes(state))
    return "live";
  return "completed";
}
