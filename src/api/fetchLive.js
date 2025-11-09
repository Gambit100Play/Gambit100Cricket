// ============================================================
// 🏏 Fetch Live Matches — Production-Safe Version (v1.0)
// ============================================================

import axios from "axios";
import { logger as customLogger } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

const HOST = "cricbuzz-cricket2.p.rapidapi.com";
const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const logger = customLogger || console;

/**
 * ✅ Fetches currently live international + league matches via Cricbuzz RapidAPI.
 * Mirrors fetchUpcoming.js for consistent structure and error handling.
 */
export async function fetchLiveMatches() {
  const url = `https://${HOST}/matches/v1/live`;

  if (!RAPID_API_KEY) {
    logger.error("🚨 [Live] Missing RAPIDAPI_KEY in environment.");
    return [];
  }

  try {
    logger.info(`📡 [Live] Fetching: ${url}`);

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
      logger.warn("⚠️ [Live] Empty or malformed API response.");
      logger.debug?.(`🔑 Response keys: ${keys.join(", ")}`);
      return [];
    }

    const matches = parseLive(response.data.typeMatches, "🔥 Live");

    if (matches.length) {
      logger.info(`🔥 [Live] Parsed ${matches.length} live matches successfully.`);
      logger.debug?.(`🩵 Sample: ${JSON.stringify(matches.slice(0, 2), null, 2)}`);
    } else {
      logger.warn("⚠️ [Live] Parsed 0 matches (check filtering logic).");
    }

    return matches;
  } catch (err) {
    const msg =
      err.response
        ? `HTTP ${err.response.status} → ${err.response.statusText}`
        : err.message || String(err);
    logger.error(`🚨 [Live] Fetch error: ${msg}`);
    if (err.toJSON) console.error("Full error:", err.toJSON());
    return [];
  }
}

/**
 * 🔍 Parses the Live matches structure (same shape as upcoming endpoint).
 */
function parseLive(typeMatches, label) {
  const matches = [];

  for (const type of typeMatches || []) {
    const seriesMatches = type.seriesMatches || [];
    for (const series of seriesMatches) {
      const wrapper = series?.seriesAdWrapper;
      if (!wrapper?.matches?.length) continue;

      const seriesName = wrapper.seriesName;

      for (const match of wrapper.matches) {
        const matchInfo = match.matchInfo || {};
        const rawState = matchInfo.state ? String(matchInfo.state).toLowerCase() : "live";
        const state = normalizeState(rawState);

        // Only keep live matches
        if (state !== "live") continue;

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
  if (!state) return "live";
  const s = state.toLowerCase();
  if (["preview", "upcoming", "scheduled", "start delay"].includes(s)) return "upcoming";
  if (["in progress", "live", "innings break", "lunch", "tea"].includes(s)) return "live";
  return "completed";
}
