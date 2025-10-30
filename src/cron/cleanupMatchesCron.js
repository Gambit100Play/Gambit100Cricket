// src/cron/cleanupMatchesCron.js
import cron from "node-cron";
import { markOldMatchesCompleted, markPastDateMatchesCompleted } from "../db/db.js";
import { fetchMatches } from "./fetchMatchesCron.js";

function stamp(...args) {
  console.log(
    "🕓",
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    "-",
    ...args
  );
}

let isRunning = false;

// ======================================================
// 🚀 Main Cron Job (Fetch + Cleanup)
// ======================================================
export async function runUpdate() {
  if (isRunning) {
    stamp("⏳ Skipping — previous cycle still running.");
    return;
  }

  isRunning = true;
  stamp("▶️ Starting update cycle...");

  try {
    const count = await fetchMatches();
    stamp(`✅ Updated DB with ${count} matches.`);

    const completed6h = await markOldMatchesCompleted(6);
    stamp(`🧹 Marked ${completed6h} matches completed (>6h old).`);

    const completedPast = await markPastDateMatchesCompleted();
    stamp(`📅 Marked ${completedPast} matches completed (past date).`);
  } catch (err) {
    stamp(`❌ Update cycle failed: ${err.message}`);
  } finally {
    isRunning = false;
    stamp("🏁 Cycle complete.\n");
  }
}

// ======================================================
// 🕒 Schedule → 6 AM & 6 PM IST daily
// ======================================================
cron.schedule("* * * * *", runUpdate, { timezone: "Asia/Kolkata" });

// Optional manual trigger for local testing
// runUpdate();
