// ============================================================
// 🧪 Test — ensureAllMatches()
// ============================================================
//
// Purpose:
// • Safely test your unified Upcoming + Live match fetcher
// • Runs a single full fetch → inserts/updates DB → logs summary
//
// Usage:
//   $ env:NETWORK="local"; node src/tests/testEnsureAllMatches.js
// ============================================================

import dotenv from "dotenv";
import { pool } from "../db/db.js";
import { ensureAllMatches } from "../api/fetchAllMatches.js";
import { logger as customLogger } from "../utils/logger.js";

dotenv.config();
const logger = customLogger || console;

(async function runTest() {
  logger.info("🧪 [Test] Starting ensureAllMatches() integration test…");

  try {
    // Run the unified fetcher
    const summary = await ensureAllMatches();
    logger.info(`✅ [Test] Fetcher finished → ${summary}`);

    // Optional: verify DB content
    logger.info("🔍 [Test] Checking stored matches in database…");
    const client = await pool.connect();

    try {
      const result = await client.query(
        `SELECT match_id, series_name, team1, team2, status, start_time 
         FROM matches 
         ORDER BY updated_at DESC 
         LIMIT 5;`
      );

      logger.info(`📊 [Test] Showing ${result.rows.length} recent rows:`);

      result.rows.forEach((row, i) => {
        logger.info(
          `#${i + 1}: [${row.status}] ${row.team1} vs ${row.team2} — ${row.series_name}`
        );
        logger.info(`     start_time: ${row.start_time}`);
      });
    } finally {
      client.release();
    }

    logger.info("🎯 [Test] Test completed successfully.");
  } catch (err) {
    logger.error("❌ [Test] Error during ensureAllMatches test:", err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    await pool.end();
    logger.info("🧹 [Test] DB connection pool closed.");
  }
})();
