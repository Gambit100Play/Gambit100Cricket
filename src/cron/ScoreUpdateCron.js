// src/cron/ScoreUpdateCron.js
import cron from "node-cron";
import { getLeanbackInfo } from "../api/cricbuzzLeanback.js";
import { getLiveMatches, insertLiveScoreSnapshot, updateMatchSummary } from "../db/db.js";

console.log("🕒 ScoreUpdateCron initialized...");

/**
 * ⏱ Fetch and store live score every 2 minutes
 * - Inserts a new row into live_scores
 * - Updates matches.score text field for quick reference
 */
cron.schedule("1 6,18 * * *", async () => {
  console.log(`\n[ScoreUpdateCron] Running: ${new Date().toLocaleString("en-IN")}`);

  try {
    const liveMatches = await getLiveMatches();

    if (!liveMatches.length) {
      console.log("✅ No live matches currently active.");
      return;
    }

    for (const match of liveMatches) {
      const matchId = match.id;
      const matchName = match.name || "Unknown match";

      console.log(`→ Fetching score for Match ID: ${matchId} (${matchName})`);

      try {
        const info = await getLeanbackInfo(matchId);

        const totalScore = `${info.score}/${info.wickets} (${info.overs})`;
        let displayStatus = `🏏 ${info.teams.batting} ${totalScore} | CRR: ${info.crr}`;

if (info.state?.toLowerCase() === "delay") {
  displayStatus += " ⏸️ (Play delayed)";
}

console.log(displayStatus);


        // --- Insert snapshot into live_scores table ---
        await insertLiveScoreSnapshot({
          match_id: matchId,
          runs: info.score,
          wickets: info.wickets,
          over_number: Math.floor(info.overs),
          ball_number: Math.round((info.overs % 1) * 10),
          total_score: totalScore,
          source: info, // keep raw JSON snapshot
        });

        // --- Update summary in matches table ---
        await updateMatchSummary(matchId, totalScore);

        console.log(`✅ Snapshot stored for ${matchName}`);
      } catch (innerErr) {
        console.error(`❌ Error fetching score for match ${matchId}:`, innerErr.message);
      }
    }
  } catch (err) {
    console.error("🚨 ScoreUpdateCron failed:", err);
  }
});
