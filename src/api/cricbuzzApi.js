// src/api/cricbuzzApi.js
import https from "https";
import dotenv from "dotenv";

dotenv.config();

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "cricbuzz-cricket.p.rapidapi.com";

/**
 * 🧠 Generic Cricbuzz Fetcher
 * Example path: "/mcenter/v1/116936"
 */
export async function fetchFromCricbuzz(path) {
  const options = {
    method: "GET",
    hostname: RAPIDAPI_HOST,
    path,
    headers: {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": RAPIDAPI_HOST,
    },
  };

  console.log(`⇢ [Cricbuzz] Fetching: ${path}`);

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error(`❌ Failed to parse Cricbuzz response for ${path}: ${err.message}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`🚨 Cricbuzz API request failed: ${err.message}`));
    });

    req.end();
  });
}

/**
 * 🏏 Fetch list of current/recent matches
 * Returns: number of matches fetched
 */
export async function fetchMatchesFromCricbuzz() {
  try {
    const data = await fetchFromCricbuzz("/matches/v1/recent");

    let matchCount = 0;
    if (data?.typeMatches?.length) {
      for (const type of data.typeMatches) {
        if (type.seriesMatches) {
          for (const series of type.seriesMatches) {
            if (series?.seriesAdWrapper?.matches) {
              matchCount += series.seriesAdWrapper.matches.length;
            }
          }
        }
      }
    }

    console.log(`📦 [CricbuzzAPI] Retrieved ${matchCount} matches.`);
    return matchCount;
  } catch (err) {
    console.error("❌ [CricbuzzAPI] Failed to fetch matches:", err.message);
    return 0;
  }
}

