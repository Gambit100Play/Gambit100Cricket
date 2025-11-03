import dotenv from "dotenv";
import { fetchInternationalMatches } from "../api/fetchInternational.js";
import { DateTime } from "luxon";

dotenv.config();

(async () => {
  const start = DateTime.now().setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
  console.log(`\n🧪 [Test] Fetching International matches @ ${start}\n`);

  const matches = await fetchInternationalMatches();

  if (!matches || matches.length === 0) {
    console.log("⚠️ No International matches found.");
    return;
  }

  console.log(`✅ Successfully fetched ${matches.length} matches!\n`);
  matches.slice(0, 5).forEach((m, i) => {
    console.log(
      `${i + 1}. ${m.team1} vs ${m.team2} — ${m.match_desc} (${m.series_name})`
    );
    console.log(`   🏟️ ${m.venue}, ${m.city}, ${m.country}`);
    console.log(`   🕒 Starts: ${m.start_date}\n`);
  });

  console.log("🎯 [Test] International fetch successful.\n");
})();
