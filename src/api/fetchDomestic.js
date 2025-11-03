// src/api/fetchDomestic.js
import axios from "axios";
import { logger as customLogger } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

const HOST = "cricbuzz-cricket2.p.rapidapi.com";
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const logger = customLogger || console;

/**
 * ✅ Fetches Domestic match schedules from Cricbuzz via RapidAPI.
 * Uses the same logging + error handling system as the International fetcher.
 */
export async function fetchDomesticMatches() {
  const lastTime = "1729555200000"; // Static cursor ensures valid data
  const url = `https://${HOST}/schedule/v1/domestic`;

  if (!RAPID_API_KEY) {
    logger.error("🚨 [Domestic] Missing RAPIDAPI_KEY in environment.");
    return [];
  }

  try {
    logger.info(`📡 [Domestic] Fetching: ${url}?lastTime=${lastTime}`);

    const response = await axios.request({
      method: "GET",
      url,
      params: { lastTime },
      headers: {
        "x-rapidapi-key": RAPID_API_KEY,
        "x-rapidapi-host": HOST,
      },
      timeout: 20000,
    });

    if (!response.data || !response.data.matchScheduleMap) {
      logger.warn("⚠️ [Domestic] Empty or malformed API response.");
      logger.debug?.(`🔑 Top-level keys: ${Object.keys(response.data || {})}`);
      return [];
    }

    const matches = parseSchedule(response.data.matchScheduleMap, "🏠 Domestic");

    if (matches.length > 0) {
      logger.info(`🏠 [Domestic] Parsed ${matches.length} matches successfully.`);
      console.log("🩵 Sample:", matches.slice(0, 3));
    } else {
      logger.warn("⚠️ [Domestic] Parsed 0 matches (check filtering logic).");
    }

    return matches;
  } catch (error) {
    const msg = error.response
      ? `Request failed with status ${error.response.status}: ${error.response.statusText}`
      : error.message || JSON.stringify(error);

    logger.error(`🚨 [Domestic] Fetch error: ${msg}`);
    console.error("🚨 [Domestic] Full error object:", error.toJSON?.() || error);
    return [];
  }
}

/**
 * 🔍 Parses Cricbuzz Domestic schedule structure.
 */
function parseSchedule(scheduleMaps, label) {
  const matches = [];

  for (const entry of scheduleMaps) {
    const wrapper = entry?.scheduleAdWrapper;
    if (!wrapper?.matchScheduleList) continue;

    for (const series of wrapper.matchScheduleList) {
      const seriesName = series.seriesName;

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
          team1: match.team1?.teamName,
          team2: match.team2?.teamName,
          venue: match.venueInfo?.ground,
          city: match.venueInfo?.city,
          country: match.venueInfo?.country,
          timezone: match.venueInfo?.timezone || "+05:30",
          status: state,
        });
      }
    }
  }

  logger.info(`${label}: ${matches.length} matches found`);
  return matches;
}

/**
 * 🎯 Normalizes Cricbuzz states.
 */
function normalizeState(state) {
  if (!state) return "upcoming";
  if (["preview", "upcoming", "scheduled", "start delay"].includes(state))
    return "upcoming";
  if (["in progress", "live", "innings break", "lunch", "tea"].includes(state))
    return "live";
  return "completed";
}
