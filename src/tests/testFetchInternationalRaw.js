import axios from "axios";
import dotenv from "dotenv";
import { DateTime } from "luxon";

dotenv.config();

const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const HOST = "cricbuzz-cricket2.p.rapidapi.com";

(async () => {
  console.log("\n🚀 Raw international API check starting...\n");

  const url = `https://${HOST}/schedule/v1/International`;
  const lastTime = "1729555200000";

  try {
    const { data } = await axios.get(url, {
      params: { lastTime },
      headers: {
        "x-rapidapi-key": RAPID_API_KEY,
        "x-rapidapi-host": HOST,
      },
      timeout: 20000,
    });

    const scheduleMaps = data?.matchScheduleMap || [];
    console.log("✅ matchScheduleMap entries:", scheduleMaps.length);

    let totalMatches = 0;
    const matches = [];

    for (const entry of scheduleMaps) {
      const wrapper = entry.scheduleAdWrapper;
      if (!wrapper?.matchScheduleList) continue;

      for (const series of wrapper.matchScheduleList) {
        for (const match of series.matchInfo || []) {
          totalMatches++;
          matches.push({
            id: match.matchId,
            series: series.seriesName,
            teams: `${match.team1?.teamName} vs ${match.team2?.teamName}`,
            venue: match.venueInfo?.ground,
            city: match.venueInfo?.city,
            start: DateTime.fromMillis(Number(match.startDate))
              .setZone("Asia/Kolkata")
              .toFormat("dd LLL yyyy, hh:mm a"),
          });
        }
      }
    }

    console.log(`\n🌍 Total parsed matches: ${totalMatches}`);
    console.dir(matches.slice(0, 5), { depth: 2 });
  } catch (err) {
    console.error("🚨 Error:", err.message);
  }
})();
