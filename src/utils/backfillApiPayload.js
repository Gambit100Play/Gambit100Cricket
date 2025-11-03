// Quick repair script (e.g., src/utils/backfillApiPayload.js)
import { query } from "../db/db.js";
import { getMatchStatusSummary } from "../api/matchStatus.js";

async function backfill(matchId) {
  const details = await getMatchStatusSummary(matchId);
  await query(
    `UPDATE matches SET api_payload = $1 WHERE match_id = $2`,
    [JSON.stringify(details), matchId]
  );
  console.log(`✅ Backfilled api_payload for match ${matchId}`);
}

backfill(124381);
