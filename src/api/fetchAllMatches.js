// ============================================================
// 🏏 Upcoming Match Fetcher — Upsert + Logging Edition (v3.1)
// ============================================================

import { pool } from "../db/db.js";
import { DateTime } from "luxon";
import { logger as customLogger } from "../utils/logger.js";
import path from "path";
import url from "url";
import fs from "fs";
import os from "os";

import { fetchUpcomingMatches } from "./fetchUpcoming.js"; // ✅ Only this fetcher is used now

const logger = customLogger || console;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 🕒 Safe UTC normalizer — prevents offset drift
// ============================================================
function toSafeUTC(dateLike) {
  try {
    if (!dateLike) return DateTime.now().toUTC();

    if (typeof dateLike === "number") {
      return DateTime.fromMillis(dateLike, { zone: "utc" });
    }

    if (typeof dateLike === "string") {
      if (/^\d+$/.test(dateLike)) {
        const n = parseInt(dateLike, 10);
        return DateTime.fromMillis(n, { zone: "utc" });
      }
      const dt = DateTime.fromISO(dateLike.trim().replace(" ", "T"), {
        zone: "utc",
      });
      if (dt.isValid) return dt.toUTC();
    }

    if (dateLike instanceof Date) {
      return DateTime.fromJSDate(dateLike, { zone: "utc" });
    }

    return DateTime.now().toUTC();
  } catch {
    return DateTime.now().toUTC();
  }
}

// ============================================================
// 💾 Lock-file + cooldown system
// ============================================================
const TMP_DIR = os.tmpdir();
const LAST_RUN_FILE = path.join(TMP_DIR, "cricpredict_last_fetch.json");
const LOCK_FILE = path.join(TMP_DIR, "cricpredict_fetch.lock");

function canFetchAgain(intervalMinutes = 15) {
  try {
    const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8"));
    const lastRun = new Date(data.lastRun).getTime();
    return Date.now() - lastRun > intervalMinutes * 60 * 1000;
  } catch {
    return true;
  }
}

function markFetchTime() {
  fs.writeFileSync(
    LAST_RUN_FILE,
    JSON.stringify({ lastRun: new Date().toISOString() })
  );
}

// ============================================================
// ⚙️ Fetch with retry backoff (handles 429)
// ============================================================
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
      const wait =
        (parseInt(err.response?.headers?.["retry-after"] ?? "10") * 1000) ||
        10000 + Math.random() * 2000;
      logger.warn(
        `⚠️ [${label}] Rate limit hit → waiting ${(wait / 1000).toFixed(
          1
        )} s (retry ${attempt}/3)`
      );
      await delay(wait);
      return runWithBackoff(label, fn, attempt + 1);
    }
    throw err;
  }
}

// ============================================================
// 🏏 Main Function — Fetch ONLY Upcoming Matches
// ============================================================
export async function ensureUpcomingMatches() {
  // 🧱 Prevent overlapping runs
  if (fs.existsSync(LOCK_FILE)) {
    const mtime = fs.statSync(LOCK_FILE).mtimeMs;
    const age = Date.now() - mtime;
    if (age < 2 * 60 * 1000) {
      logger.warn("⚠️ [FetchUpcoming] Skipped — another fetch still running.");
      return "skipped_overlap";
    }
    if (age > 10 * 60 * 1000) {
      logger.warn("🧹 [FetchUpcoming] Removing stale lock file (>10 min old).");
      fs.unlinkSync(LOCK_FILE);
    }
  }

  // 🕒 Enforce 15-minute cooldown
  if (!canFetchAgain(15)) {
    logger.info("🕒 [FetchUpcoming] Skipped — cooldown active (≤15 min).");
    return "skipped_cooldown";
  }

  fs.writeFileSync(LOCK_FILE, "LOCKED");
  markFetchTime();

  const start = Date.now();
  logger.info("⚡ [FetchUpcoming] Starting fetch of upcoming matches…");

  try {
    const matches = await runWithBackoff("Upcoming", fetchUpcomingMatches);

    if (!matches?.length) {
      logger.warn("⚠️ [FetchUpcoming] No matches fetched — check endpoint.");
      return "no_matches";
    }

    const client = await pool.connect();
    let inserted = 0;
    let updated = 0;

    try {
      const q = `
        INSERT INTO matches (
          id, name, match_id, series_id, series_name, match_desc, match_format,
          start_time, start_date, start_time_local, end_date,
          team1, team2, venue, city, country, status,
          timezone, category, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,
          $18,$19,NOW()
        )
        ON CONFLICT (match_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          start_time = EXCLUDED.start_time,
          end_date = EXCLUDED.end_date,
          updated_at = NOW();
      `;

      for (const m of matches) {
        try {
          const id = `m-${m.match_id}`;
          const name = `${m.team1 ?? "TBD"} vs ${m.team2 ?? "TBD"}`;
          const startDT = toSafeUTC(m.start_date || m.startTime || m.startDate);
          const endDT = m.end_date
            ? toSafeUTC(m.end_date)
            : startDT.plus({ hours: 4 });

          const res = await client.query(q, [
            id,
            name,
            m.match_id,
            m.series_id,
            m.series_name ?? "Unknown Series",
            m.match_desc ?? "",
            m.match_format ?? "",
            startDT.toISO(),
            startDT.toISODate(),
            startDT.setZone("Asia/Kolkata").toFormat("HH:mm:ss"),
            endDT.toISO(),
            m.team1 ?? "TBD",
            m.team2 ?? "TBD",
            m.venue ?? "Unknown Ground",
            m.city ?? "",
            m.country ?? "",
            m.status ?? "upcoming",
            m.timezone ?? "+05:30",
            "upcoming",
          ]);

          if (res.rowCount > 0) inserted++;
          else updated++;
        } catch (e) {
          logger.error(`❌ [FetchUpcoming] Insert failed ${m.match_id}: ${e.message}`);
        }
      }

      const total = inserted + updated;
      const dur = ((Date.now() - start) / 1000).toFixed(2);

      const check = await client.query("SELECT COUNT(*) FROM matches");
      const count = check.rows[0].count;

      logger.info(`💾 [FetchUpcoming] Inserted/updated ${total} (${inserted} new). DB now has ${count} total.`);
      logger.info(`⏱️ [FetchUpcoming] Completed in ${dur}s.`);
      return `inserted ${inserted}, updated ${updated}, total ${count}`;
    } finally {
      client.release();
    }
  } catch (e) {
    logger.error(`🚨 [FetchUpcoming] Fatal error: ${e.message}`);
    return `error: ${e.message}`;
  } finally {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  }
}

// ============================================================
// 👟 CLI entry (manual testing)
// ============================================================
const currentFile = url.fileURLToPath(import.meta.url);
if (path.resolve(currentFile) === path.resolve(process.argv[1])) {
  (async () => {
    logger.info("🧪 [CLI] Running ensureUpcomingMatches() manually…");
    const summary = await ensureUpcomingMatches();
    logger.info(`🏁 [CLI] Done. Summary: ${summary}`);
    process.exit(0);
  })();
}
