// ============================================================
// 🌍 Fetch Upcoming Matches — Production-Safe Version
// ============================================================

import axios from "axios";
import { logger as customLogger } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

const HOST = "cricbuzz-cricket2.p.rapidapi.com";
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const logger = customLogger || console;

/**
 * ✅ Fetches upcoming international + league matches via Cricbuzz RapidAPI.
 * Identical structure to fetchDomestic.js, with safe error handling and logging.
 */
export async function fetchUpcomingMatches() {
  const url = `https://${HOST}/matches/v1/upcoming`;

  if (!RAPID_API_KEY) {
    logger.error("🚨 [Upcoming] Missing RAPIDAPI_KEY in environment.");
    return [];
  }

  try {
    logger.info(`📡 [Upcoming] Fetching: ${url}`);

    const response = await axios.get(url, {
      headers: {
        "x-rapidapi-key": RAPID_API_KEY,
        "x-rapidapi-host": HOST,
      },
      timeout: 20000,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (!response?.data || !response.data.typeMatches) {
      const keys = Object.keys(response?.data || {});
      logger.warn("⚠️ [Upcoming] Empty or malformed API response.");
      logger.debug?.(`🔑 Response keys: ${keys.join(", ")}`);
      return [];
    }

    const matches = parseUpcoming(response.data.typeMatches, "🌍 Upcoming");

    if (matches.length) {
      logger.info(`🌍 [Upcoming] Parsed ${matches.length} matches successfully.`);
      logger.debug?.(`🩵 Sample: ${JSON.stringify(matches.slice(0, 2), null, 2)}`);
    } else {
      logger.warn("⚠️ [Upcoming] Parsed 0 matches (check filtering logic).");
    }

    return matches;
  } catch (err) {
    const msg =
      err.response
        ? `HTTP ${err.response.status} → ${err.response.statusText}`
        : err.message || String(err);
    logger.error(`🚨 [Upcoming] Fetch error: ${msg}`);
    if (err.toJSON) console.error("Full error:", err.toJSON());
    return [];
  }
}

/**
 * 🔍 Parses the Upcoming matches structure.
 */
function parseUpcoming(typeMatches, label) {
  const matches = [];

  for (const type of typeMatches || []) {
    const seriesMatches = type.seriesMatches || [];
    for (const series of seriesMatches) {
      const wrapper = series?.seriesAdWrapper;
      if (!wrapper?.matches?.length) continue;

      const seriesName = wrapper.seriesName;

      for (const match of wrapper.matches) {
        const matchInfo = match.matchInfo || {};
        const rawState = matchInfo.state ? String(matchInfo.state).toLowerCase() : "upcoming";
        const state = normalizeState(rawState);

        // Keep only upcoming or live matches
        if (!["upcoming", "live"].includes(state)) continue;

        matches.push({
          match_id: matchInfo.matchId,
          series_id: matchInfo.seriesId,
          series_name: seriesName ?? "Unknown Series",
          match_desc: matchInfo.matchDesc ?? "",
          match_format: matchInfo.matchFormat ?? "",
          team1: matchInfo.team1?.teamName ?? "TBD",
          team2: matchInfo.team2?.teamName ?? "TBD",
          venue: matchInfo.venueInfo?.ground ?? "Unknown Ground",
          city: matchInfo.venueInfo?.city ?? "",
          country: matchInfo.venueInfo?.country ?? "",
          timezone: matchInfo.venueInfo?.timezone || "+05:30",
          status: state,
          start_date: matchInfo.startDate || null,
          end_date: matchInfo.endDate || null,
        });
      }
    }
  }

  logger.info(`${label}: ${matches.length} matches found`);
  return matches;
}

/**
 * 🎯 Normalizes Cricbuzz match states for consistent handling.
 */
function normalizeState(state) {
  if (!state) return "upcoming";
  const s = state.toLowerCase();
  if (["preview", "upcoming", "scheduled", "start delay"].includes(s)) return "upcoming";
  if (["in progress", "live", "innings break", "lunch", "tea"].includes(s)) return "live";
  return "completed";
}
