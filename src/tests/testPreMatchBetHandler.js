// src/tests/testPreMatchBetHandler.js
import dotenv from "dotenv";
dotenv.config();

import { DateTime } from "luxon";
import { logger } from "../utils/logger.js";
import { getMatchById } from "../db/db.js";
import { startPreMatchBet } from "../bot/handlers/preMatchBetHandler.js";

/* ============================================================
 🧩 Mock Telegram Context
============================================================ */
function createMockCtx() {
  return {
    from: { id: 999999, first_name: "TestUser", language_code: "en" },
    reply: async (msg, opts = {}) => {
      logger.info(`💬 BOT REPLY:\n${msg}`);
      if (opts?.reply_markup)
        logger.info(
          `🎛️ Buttons → ${JSON.stringify(opts.reply_markup.inline_keyboard)}`
        );
    },
    answerCbQuery: async (msg) => logger.info(`✅ answerCbQuery: ${msg || "(none)"}`),
  };
}

/* ============================================================
 🧠 Main Test Runner
============================================================ */
async function runPreMatchTest() {
  logger.info("🧪 [Test] Starting PreMatchBetHandler Diagnostic Test...");
  const ctx = createMockCtx();

  // Choose a known match ID (change this ID to one existing in your DB)
  const testMatchId = 124381;

  try {
    const match = await getMatchById(testMatchId);

    if (!match) {
      logger.warn(`⚠️ No match found in DB with ID ${testMatchId}`);
      return;
    }

    logger.info(
      `📘 Testing Pre-Match Screen for: ${match.name} (${match.match_id})`
    );
    logger.info(
      `📅 Stored Start Time: ${
        match.start_time
      } → Local (IST): ${DateTime.fromJSDate(
        new Date(match.start_time)
      ).setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a")}`
    );

    // Run the core screen builder
    await startPreMatchBet(ctx, testMatchId);

    logger.info("✅ [Test] PreMatch screen executed successfully.");
  } catch (err) {
    logger.error(`💥 [Test] PreMatch test failed: ${err.message}`);
  } finally {
    logger.info("🏁 [Test] Completed PreMatchBetHandler Diagnostics.");
  }
}

/* ============================================================
 🚀 Execute
============================================================ */
runPreMatchTest()
  .then(() => {
    logger.info("🏁 [Test] Script completed without fatal errors.");
  })
  .catch((err) => {
    logger.error("❌ [Test] Fatal error:", err);
  });
