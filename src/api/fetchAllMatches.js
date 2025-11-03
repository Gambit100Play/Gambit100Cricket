import { pool } from "../db/db.js";
import { DateTime } from "luxon";
import { logger as customLogger } from "../utils/logger.js";
import path from "path";
import url from "url";

import { fetchInternationalMatches } from "./fetchInternational.js";
import { fetchLeagueMatches } from "./fetchLeague.js";
import { fetchDomesticMatches } from "./fetchDomestic.js";
import { fetchWomenMatches } from "./fetchWomen.js";

const logger = customLogger || console;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runWithBackoff(label, fn, attempt = 1) {
  try {
    const t0 = Date.now();
    const data = await fn();
    const t1 = ((Date.now() - t0) / 1000).toFixed(1);
    logger.info(`⏱️ [${label}] Completed in ${t1}s.`);
    return data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 && attempt <= 3) {
      const retryAfter =
        parseInt(err.response?.headers?.["retry-after"] ?? "10") * 1000;
      const wait = retryAfter || 10000 + Math.random() * 2000;
      logger.warn(
        `⚠️ [${label}] Rate limit hit. Waiting ${(wait / 1000).toFixed(
          1
        )}s before retry (${attempt}/3)...`
      );
      await delay(wait);
      return runWithBackoff(label, fn, attempt + 1);
    }
    throw err;
  }
}

/* ============================================================
 🕒 Safe UTC normalizer
============================================================ */
function toSafeUTC(dateLike) {
  if (!dateLike) return DateTime.now().toUTC();

  // Handle both ISO and SQL-like strings
  let dt;
  if (typeof dateLike === "string") {
    const raw = dateLike.trim().replace(" ", "T");
    dt = DateTime.fromISO(raw, { zone: "utc" });
    if (!dt.isValid)
      dt = DateTime.fromFormat(dateLike, "yyyy-LL-dd HH:mm:ss", {
        zone: "utc",
      });
  } else if (dateLike instanceof Date) {
    dt = DateTime.fromJSDate(dateLike, { zone: "utc" });
  }

  return dt?.isValid ? dt.toUTC() : DateTime.now().toUTC();
}

/* ============================================================
 🏏 Unified Match Fetcher (with ISO-UTC insertion)
============================================================ */
export async function ensureUpcomingMatches() {
  const start = Date.now();
  logger.info("⚡ [FetchAll] Starting unified fetch (sequential rate-safe mode)...");

  try {
    const categories = [
      ["International", fetchInternationalMatches],
      ["League", fetchLeagueMatches],
      ["Domestic", fetchDomesticMatches],
      ["Women", fetchWomenMatches],
    ];

    const allMatches = [];

    for (const [label, fn] of categories) {
      try {
        const res = await runWithBackoff(label, fn);
        allMatches.push(...(res || []));
      } catch (err) {
        logger.error(
          `🚨 [${label}] Final failure: ${err.message || err.toString()}`
        );
      }
      await delay(2000);
    }

    if (!allMatches.length) {
      logger.warn("⚠️ [FetchAll] No matches returned from any category.");
      return;
    }

    const uniqueMatches = Array.from(
      new Map(allMatches.map((m) => [m.match_id, m])).values()
    );
    logger.info(
      `🧩 [FetchAll] Combined ${allMatches.length} total → ${uniqueMatches.length} unique matches.`
    );

    const client = await pool.connect();
    try {
      const q = `
        INSERT INTO matches (
          id, name, match_id, series_id, series_name, match_desc, match_format,
          start_time, start_date, start_time_local, end_date,
          team1, team2, venue, city, country, status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17
        )
        ON CONFLICT (match_id) DO NOTHING;`;

      let inserted = 0;

      for (const m of uniqueMatches) {
        try {
          const id = String(m.match_id);
          const name = `${m.team1 ?? "TBD"} vs ${m.team2 ?? "TBD"}`;

          // ✅ Normalize start/end times to strict UTC ISO
          // ✅ Detect if incoming date has +05:30 and normalize to true UTC
let startDT = toSafeUTC(m.start_date);
if (startDT.offset === 330) startDT = startDT.setZone("utc");

let endDT = m.end_date ? toSafeUTC(m.end_date) : startDT.plus({ hours: 4 });
if (endDT.offset === 330) endDT = endDT.setZone("utc");


          const startTime = startDT.toUTC().toISO(); // e.g. 2025-11-01T00:00:00.000Z
          const startDate = startDT.toUTC().toISODate(); // YYYY-MM-DD
          const startTimeLocal = startDT.toUTC().toFormat("HH:mm:ss");
          const endDate = endDT.toUTC().toISO();

          await client.query(q, [
            id,
            name,
            m.match_id,
            m.series_id,
            m.series_name ?? "Unknown Series",
            m.match_desc ?? "",
            m.match_format ?? "",
            startTime,
            startDate,
            startTimeLocal,
            endDate,
            m.team1 ?? "TBD",
            m.team2 ?? "TBD",
            m.venue ?? "Unknown Ground",
            m.city ?? "",
            m.country ?? "",
            m.status ?? "upcoming",
          ]);
          inserted++;
        } catch (e) {
          logger.error(`❌ [FetchAll] Insert failed ${m.match_id}: ${e.message}`);
        }
      }

      logger.info(`✅ [FetchAll] ${inserted} new matches inserted.`);
    } finally {
      client.release();
    }

    const dur = ((Date.now() - start) / 1000).toFixed(2);
    logger.info(`⏱️ [FetchAll] Done in ${dur}s.`);
  } catch (e) {
    logger.error(`🚨 [FetchAll] Fatal: ${e.message}`);
  }
}

/* ============================================================
 👟 CLI entry
============================================================ */
const currentFile = url.fileURLToPath(import.meta.url);
if (path.resolve(currentFile) === path.resolve(process.argv[1])) {
  (async () => {
    logger.info("🧪 [CLI] Running ensureUpcomingMatches() manually...");
    await ensureUpcomingMatches();
    logger.info("🏁 [CLI] All done, exiting.");
    process.exit(0);
  })();
}
