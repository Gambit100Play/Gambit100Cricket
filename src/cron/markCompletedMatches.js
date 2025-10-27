import cron from "node-cron";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { getPastActiveMatches, updateMatchStatus } from "../db/db.js";

dotenv.config();
const CRICAPI_KEY = process.env.CRICAPI_KEY;

// ⚙️ Helper — Fetch live match info
async function fetchMatchStatus(matchId) {
  const url = `https://api.cricapi.com/v1/match_info?apikey=${CRICAPI_KEY}&id=${matchId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const status = data?.data?.status?.toLowerCase() || "";
    return status;
  } catch (err) {
    console.error(`❌ [Cron] Failed fetching status for ${matchId}:`, err.message);
    return null;
  }
}

// 🕒 Schedule — every 15 minutes
cron.schedule("*/15 * * * *", async () => {
  console.log("🕒 [Cron] Checking for completed past matches...");

  const activeMatches = await getPastActiveMatches();
  if (!activeMatches.length) {
    console.log("✅ No past active matches found.");
    return;
  }

  for (const match of activeMatches) {
    const currentStatus = await fetchMatchStatus(match.id);
    if (!currentStatus) continue;

    // ✅ Detect completed/finished matches
    if (
      currentStatus.includes("completed") ||
      currentStatus.includes("finished") ||
      currentStatus.includes("result") ||
      currentStatus.includes("abandoned") ||
      currentStatus.includes("cancelled")
    ) {
      await updateMatchStatus(match.id, "completed");
    }
  }

  console.log("🏁 [Cron] Completed past matches check done.");
});
