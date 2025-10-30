// src/api/cricbuzzLeanback.js
import https from "https";
import dotenv from "dotenv";
dotenv.config();

/**
 * Fetch leanback live score / overs / toss info for a match
 * + Automatically detects match phase (upcoming, toss, live, complete)
 * @param {string|number} matchId - Cricbuzz match ID
 * @returns {Promise<object>} Lean summary of match
 */
export async function getLeanbackInfo(matchId) {
  const options = {
    method: "GET",
    hostname: "cricbuzz-cricket2.p.rapidapi.com",
    path: `/mcenter/v1/${matchId}/leanback`,
    headers: {
      "x-rapidapi-key": process.env.RAPIDAPI_KEY,
      "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const mini = json?.miniscore || {};
          const header = json?.matchheaders || {};

          const overs = mini.inningsscores?.inningsscore?.[0]?.overs || 0;
          const state = header.state?.toLowerCase() || "";
          const status = header.status?.toLowerCase() || "";
          const tossText = header.tossresults
            ? `${header.tossresults.tosswinnername} opt to ${header.tossresults.decision}`
            : "";

          // ---- Detect match phase ----
          let phase = "upcoming";
          if (status.includes("toss") || status.includes("opt to")) phase = "toss";
          if (overs > 0) phase = "live";
          if (state.includes("complete") || status.includes("won")) phase = "complete";

          // --- Extract key details ---
          const info = {
            matchId,
            phase,
            teams: {
              batting: header.teamdetails?.batteamname,
              bowling: header.teamdetails?.bowlteamname,
            },
            status: header.status,
            state: header.state,
            toss: tossText || "Toss not yet available",
            score: mini.inningsscores?.inningsscore?.[0]?.runs || 0,
            wickets: mini.inningsscores?.inningsscore?.[0]?.wickets || 0,
            overs,
            striker: mini.batsmanstriker?.name || "–",
            nonStriker: mini.batsmannonstriker?.name || "–",
            bowler: mini.bowlerstriker?.name || "–",
            crr: mini.crr,
            innings: mini.inningsnbr,
          };

          resolve(info);
        } catch (err) {
          reject(new Error(`❌ Failed to parse leanback data: ${err.message}`));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`🚨 HTTPS error: ${err.message}`)));
    req.end();
  });
}
