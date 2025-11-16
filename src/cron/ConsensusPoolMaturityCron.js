// src/cron/ConsensusPoolMaturityCron.js
import cron from "node-cron";
import { query } from "../db/db.js";
import { DateTime } from "luxon";
import { logger } from "../utils/logger.js";

// 🧠 This cron checks every 15 minutes for Consensus polls older than 24 hours
// and moves them from 'open' → 'pending' so they can later be closed or paid out.
export default function ConsensusPoolMaturityCron(bot) {
  logger.info("🕓 [Cron] ConsensusPoolMaturityCron (v2.0) initialized — runs every 15 min.");

  // Schedule: runs every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    try {
      const now = DateTime.now().toUTC();

      // 🔍 Find all open consensus pools older than 24h
      const res = await query(`
        SELECT id, created_at
        FROM pools
        WHERE pool_type = 'Consensus'
          AND status = 'open'
          AND created_at <= (NOW() - INTERVAL '24 hours')
      `);

      if (!res.rows.length) {
        logger.debug("✅ [ConsensusPoolMaturityCron] No open Consensus pools to update.");
        return;
      }

      for (const row of res.rows) {
        // Calculate age for logging
        const created = DateTime.fromJSDate(row.created_at);
        const hoursOld = Math.floor(now.diff(created, "hours").hours);

        await query(
          `UPDATE pools
             SET status = 'pending',
                 updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );

        logger.info(`⏰ Consensus pool #${row.id} moved to 'pending' (${hoursOld}h old)`);

        // Optional admin notification
        // const ADMIN_ID = 5171349113;
        // await bot.telegram.sendMessage(
        //   ADMIN_ID,
        //   `⏰ Consensus poll #${row.id} has automatically moved to *PENDING* after 24 hours.`,
        //   { parse_mode: "Markdown" }
        // );
      }
    } catch (err) {
      logger.error("❌ [ConsensusPoolMaturityCron] Error:", err);
    }
  });
}
