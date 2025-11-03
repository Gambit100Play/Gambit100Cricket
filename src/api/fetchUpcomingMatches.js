import axios from "axios";
import { DateTime } from "luxon";
import { pool } from "../db/db.js";

const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const CRICBUZZ_HOST = "cricbuzz-cricket2.p.rapidapi.com";

/**
 * 🔁 Fetches and stores upcoming/live matches from all categories:
 * International, League, Domestic, and Women.
 * Ensures only distinct matches exist in DB.
 */
export async function ensureUpcomingMatches() {
  try {
    // 1️⃣ Check current live/upcoming matches
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM matches WHERE status IN ('live', 'upcoming');`
    );
    const total = rows[0]?.count ?? 0;
    console.log(`📊 Found ${total} live/upcoming matches in DB`);

    if (total >= 10) {
      console.log("✅ Enough matches in DB — skipping API fetch.");
      return;
    }

    // 2️⃣ Define all 4 Cricbuzz endpoints
    console.log("⚡ Fetching matches from Cricbuzz (Intl + League + Domestic + Women)...");
    const now = Date.now();

    const endpoints = [
      `https://${CRICBUZZ_HOST}/schedule/v1/International?lastTime=${now}`,
      `https://${CRICBUZZ_HOST}/schedule/v1/league?lastTime=${now}`,
      `https://${CRICBUZZ_HOST}/schedule/v1/domestic?lastTime=${now}`,
      `https://${CRICBUZZ_HOST}/schedule/v1/women?lastTime=${now}`,
    ];

    // 3️⃣ Fetch in parallel with fallback handling
    const responses = await Promise.allSettled(
      endpoints.map((url) =>
        axios.get(url, {
          timeout: 15000,
          headers: {
            "x-rapidapi-key": RAPID_API_KEY,
            "x-rapidapi-host": CRICBUZZ_HOST,
          },
        })
      )
    );

    // 4️⃣ Parse all valid responses
    const allParsedMatches = [];

    for (const result of responses) {
      if (result.status !== "fulfilled") {
        console.warn("⚠️ Failed to fetch one category:", result.reason?.message);
        continue;
      }

      const data = result.value.data;
      const scheduleMaps = data?.[0]?.matchScheduleMap || [];

      for (const entry of scheduleMaps) {
        const wrapper = entry.scheduleAdWrapper;
        if (!wrapper) continue;

        for (const series of wrapper.matchScheduleList || []) {
          const seriesName = series.seriesName;
          for (const match of series.matchInfo || []) {
            const rawState = match?.state?.toLowerCase() || "upcoming";
            const normalizedState = normalizeMatchState(rawState);
            if (!["upcoming", "live"].includes(normalizedState)) continue;

            allParsedMatches.push({
              match_id: match.matchId,
              series_id: match.seriesId,
              series_name: seriesName,
              match_desc: match.matchDesc,
              match_format: match.matchFormat,
              start_date: DateTime.fromMillis(Number(match.startDate))
                .setZone("Asia/Kolkata")
                .toISO(),
              end_date: DateTime.fromMillis(Number(match.endDate))
                .setZone("Asia/Kolkata")
                .toISO(),
              team1: match.team1?.teamName,
              team2: match.team2?.teamName,
              venue: match.venueInfo?.ground,
              city: match.venueInfo?.city,
              country: match.venueInfo?.country,
              timezone: match.venueInfo?.timezone || "+05:30",
              status: normalizedState,
            });
          }
        }
      }
    }

    if (allParsedMatches.length === 0) {
      console.log("⚠️ No upcoming/live matches found across all endpoints.");
      return;
    }

    // 5️⃣ Deduplicate by match_id
    const uniqueMatches = Array.from(
      new Map(allParsedMatches.map((m) => [m.match_id, m])).values()
    );
    console.log(
      `🧩 Parsed ${allParsedMatches.length} matches, ${uniqueMatches.length} unique after deduplication.`
    );

    // 6️⃣ Insert into DB (ON CONFLICT ignores duplicates)
    const client = await pool.connect();
    try {
      const insertQuery = `
        INSERT INTO matches (
          match_id, series_id, series_name, match_desc, match_format, 
          start_date, end_date, team1, team2, venue, city, country, timezone, status
        )
        VALUES ${uniqueMatches
          .map(
            (_, i) =>
              `($${i * 14 + 1},$${i * 14 + 2},$${i * 14 + 3},$${i * 14 + 4},$${i * 14 + 5},
                $${i * 14 + 6},$${i * 14 + 7},$${i * 14 + 8},$${i * 14 + 9},$${i * 14 + 10},
                $${i * 14 + 11},$${i * 14 + 12},$${i * 14 + 13},$${i * 14 + 14})`
          )
          .join(",")}
        ON CONFLICT (match_id) DO NOTHING;
      `;

      const flatValues = uniqueMatches.flatMap((m) => [
        m.match_id,
        m.series_id,
        m.series_name,
        m.match_desc,
        m.match_format,
        m.start_date,
        m.end_date,
        m.team1,
        m.team2,
        m.venue,
        m.city,
        m.country,
        m.timezone,
        m.status,
      ]);

      await client.query(insertQuery, flatValues);
      console.log(`✅ ${uniqueMatches.length} new matches inserted successfully.`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("🚨 Error fetching matches:", err.message);
  }
}

/**
 * 🧠 Normalizes match state to "upcoming" | "live" | "completed"
 */
function normalizeMatchState(state) {
  if (!state) return "upcoming";
  if (["preview", "upcoming", "scheduled", "start delay"].includes(state))
    return "upcoming";
  if (["in progress", "live", "innings break", "lunch", "tea"].includes(state))
    return "live";
  return "completed";
}
