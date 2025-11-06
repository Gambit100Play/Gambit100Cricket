// src/scripts/fetchLiveScore.js
import axios from "axios";
import dotenv from "dotenv";
import { query } from "../db/db.js";

dotenv.config();

export async function fetchLiveScore(matchId) {
  console.log(`📡 Fetching live score for matchId=${matchId}`);

  const url = `https://cricbuzz-cricket2.p.rapidapi.com/mcenter/v1/${matchId}/leanback`;

  try {
    const response = await axios.get(url, {
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "cricbuzz-cricket2.p.rapidapi.com",
      },
      timeout: 15000,
    });

    const data = response.data;
    if (!data?.miniscore || !data?.matchheaders) {
      console.warn(`⚠️ No valid miniscore found for match ${matchId}`);
      return null;
    }

    const ms = data.miniscore;
    const header = data.matchheaders;

    const team1 = header.team1?.teamname || "Team A";
    const team2 = header.team2?.teamname || "Team B";
    const state = header.state || "Unknown";
    const status = header.status || "";

    const innings = ms.inningsscores?.inningsscore?.[ms.inningsid - 1] || {};
    const runs = innings.runs ?? ms.batteamscore?.teamscore ?? 0;
    const wickets = innings.wickets ?? ms.batteamscore?.teamwkts ?? 0;
    const overs = innings.overs ?? 0;

    const bats = [ms.batsmanstriker, ms.batsmannonstriker].filter(Boolean);
    const boundaries =
      bats.reduce((acc, b) => acc + (b.fours || 0) + (b.sixes || 0), 0) || 0;

    // 🗄️ Update all active live_pools for this match
    const updateSQL = `
      UPDATE live_pools
      SET options = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(options, '{current_runs}', to_jsonb($2::numeric), true),
              '{current_wickets}', to_jsonb($3::numeric), true
            ),
            '{current_boundaries}', to_jsonb($4::numeric), true
          ),
          '{current_over}', to_jsonb($5::numeric), true
        ),
        '{last_updated_at}', to_jsonb(NOW()::text), true
      ),
      updated_at = NOW()
      WHERE matchid = $1 AND status = 'active'
    `;

    await query(updateSQL, [matchId, runs, wickets, boundaries, overs]);
    console.log(`✅ live_pools updated successfully for match ${matchId}`);

    // Return snapshot to cron
    return { team1, team2, runs, wickets, overs, boundaries, state, status };
  } catch (err) {
    console.error(`❌ Failed to fetch live score for ${matchId}: ${err.message}`);
    return null;
  }
}

// allow manual CLI usage
if (process.argv[1].includes("fetchLiveScore.js")) {
  const matchId = process.argv[2];
  if (!matchId) {
    console.error("Usage: node src/scripts/fetchLiveScore.js <matchId>");
    process.exit(1);
  }
  fetchLiveScore(matchId).then(() => process.exit(0));
}
