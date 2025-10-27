// src/utils/updateNow.js
process.env.TZ = "UTC";

import dotenv from "dotenv";
import { DateTime } from "luxon";
import { fetchMatches } from "../api/cricApi.js";
import { getMatches } from "../db/db.js";

dotenv.config();

function stamp(...args) {
  console.log("🕓", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), "-", ...args);
}

function formatLocalTime(input, timeZone = "Asia/Kolkata") {
  if (!input) return "TBA";
  let dt;
  if (input instanceof Date) dt = DateTime.fromJSDate(input, { zone: "utc" });
  else if (typeof input === "string") {
    dt = input.includes("T")
      ? DateTime.fromISO(input, { zone: "utc" })
      : DateTime.fromSQL(input, { zone: "utc" });
  } else if (typeof input === "number") {
    dt = DateTime.fromMillis(input, { zone: "utc" });
  }

  if (!dt?.isValid) return "Invalid Time";
  return dt.setZone(timeZone).toFormat("dd LLL yyyy, hh:mm a ZZZZ");
}


function isScheduledStatus(s) {
  const status = (s || "").toLowerCase();
  return (
    status.includes("not started") ||
    status.includes("scheduled") ||
    status.includes("upcoming") ||
    status.includes("fixture")
  );
}

async function main() {
  stamp("▶️ Starting immediate match update...");

  try {
    const result = await fetchMatches();

    if (Array.isArray(result)) stamp(`✅ fetchMatches() returned an array of ${result.length} items.`);
    else if (typeof result === "number") stamp(`✅ Saved ${result} matches (live/upcoming).`);
    else stamp("⚠️ fetchMatches() returned:", result);

    // Now pull from DB
    const allMatches = await getMatches();
    if (!allMatches || allMatches.length === 0) {
      stamp("📭 No matches found in the database.");
      return;
    }

    // Filter only upcoming/scheduled matches
    const scheduled = allMatches
      .filter(m => isScheduledStatus(m.status))
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    if (scheduled.length === 0) {
      stamp("📭 No scheduled/upcoming matches right now.");
      return;
    }

    console.log("\n📅 Latest Scheduled/Upcoming Matches (IST):");
    for (const m of scheduled) {
      const when = formatLocalTime(m.start_time);
      console.log(`🕓 ${m.name} — ${when} (${m.id})`);
    }

    console.log(`\n✅ Total scheduled/upcoming: ${scheduled.length}\n`);
  } catch (err) {
    console.error("❌ Immediate update failed:", err?.message || err);
    console.error(err);
  }
}

main();
