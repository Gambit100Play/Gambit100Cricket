// src/tests/testMatches.js
import dotenv from "dotenv";
import fetch from "node-fetch";
import { saveMatch, getMatches } from "../db/db.js";

dotenv.config();

const CRICAPI_KEY = process.env.CRICAPI_KEY;

async function fetchMatchesFromCricAPI() {
  console.log("🔄 Fetching matches from CricAPI...");

  const url = `https://api.cricapi.com/v1/matches?apikey=${CRICAPI_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data || !data.data) {
    console.error("❌ CricAPI returned no matches:", data);
    return [];
  }

  // Save each match into DB
  for (const m of data.data) {
    const match = {
      id: m.id,
      name: `${m.teams?.[0]} vs ${m.teams?.[1]}`,
      start_time: m.dateTimeGMT,
      status: m.status,
      score: m.score || null,
      api_payload: m,
    };
    await saveMatch(match);
  }

  console.log(`✅ Saved ${data.data.length} matches into DB.`);
  return data.data;
}

async function test() {
  try {
    // Step 1: Fetch & save from CricAPI
    await fetchMatchesFromCricAPI();

    // Step 2: Retrieve from DB
    const matches = await getMatches();
    console.log("📅 Matches in DB:");
    console.table(matches);
  } catch (err) {
    console.error("❌ Test failed:", err);
  } finally {
    process.exit();
  }
}

test();
