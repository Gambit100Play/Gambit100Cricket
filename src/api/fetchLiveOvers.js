// api/fetchLiveOvers.js
import axios from "axios";
import { logger } from "../utils/logger.js";

// small sleep helper
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchLiveOvers(matchId) {
  const url = `https://cricbuzz-cricket.p.rapidapi.com/mcenter/v1/${matchId}/overs`;

  const headers = {
    "x-rapidapi-key": process.env.RAPIDAPI_KEY,
    "x-rapidapi-host": "cricbuzz-cricket.p.rapidapi.com",
  };

  let attempts = 0;
  let result = null;

  while (attempts < 2) {
    try {
      const res = await axios.get(url, { headers });
      result = res.data || {};

      // Normalize state early
      const state = (result?.matchheaders?.state || "").toLowerCase();
      result.state = state;                  // ensure state always available

      // If overs exist normally → return as-is
      if (result.overseplist) {
        return result;
      }

      // If Cricbuzz did not send overs but state indicates non-playing situation:
      if (
        state.includes("delay") ||
        state.includes("innings break") ||
        state.includes("rain") ||
        state.includes("drinks") ||
        state.includes("stumps") ||
        state.includes("complete") ||
        state.includes("match ended") ||
        state.includes("close of play")
      ) {
        // structured fallback
        return {
          overseplist: result.overseplist || { oversep: [] },
          miniscore: result.miniscore || {},
          matchheaders: result.matchheaders || {},
          state
        };
      }

      // Temporary glitch → retry
      logger.warn(
        `[fetchLiveOvers] Attempt ${attempts + 1} → overseplist missing`
      );

    } catch (err) {
      logger.warn(
        `[fetchLiveOvers] Attempt ${attempts + 1} failed: ${err.message}`
      );
    }

    attempts++;
    await wait(300); // slight retry pause
  }

  // FINAL fallback — never return undefined structures
  logger.warn(`[fetchLiveOvers] Fallback used → returning safe empty data`);

  return {
    overseplist: { oversep: [] },
    miniscore: {},
    matchheaders: {},
    state: ""
  };
}
