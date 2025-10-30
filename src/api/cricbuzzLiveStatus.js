// src/api/cricbuzzLiveStatus.js
import https from "https";
import dotenv from "dotenv";
dotenv.config();

/**
 * Fetch live match status (fast endpoint)
 * @param {string|number} matchId Cricbuzz match ID (e.g., 100238)
 * @returns {Promise<Object>} Object with status summary
 */
export async function getLiveMatchStatus(matchId) {
  const options = {
    method: "GET",
    hostname: "cricbuzz-cricket2.p.rapidapi.com",
    path: `/mcenter/v1/${matchId}`,
    headers: {
      "x-rapidapi-key": process.env.RAPIDAPI_KEY,
      "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
    },
  };

  console.log(`⇢ [CricbuzzLive] Checking live status for match ${matchId}`);

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);

          // Extract key info
          const status = json?.matchheaders?.status || "";
          const state = json?.matchheaders?.state || "";
          const event = json?.miniscore?.event || "";
          const custstatus = json?.miniscore?.custstatus || "";

          resolve({
            matchId,
            status,
            state,
            event,
            custstatus,
            raw: json,
          });
        } catch (err) {
          reject(new Error(`❌ JSON parse failed for match ${matchId}: ${err.message}`));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`🚨 HTTPS error: ${err.message}`)));
    req.end();
  });
}
