// =====================================================
// 🚀 BOT INSTANCE + MATCH START WATCHER INITIALIZATION
// =====================================================
import { logger } from "../utils/logger.js";
import { createBot } from "./botCore.js"; // optional if separated, else keep your existing import

// ✅ Create the bot instance from environment token
const bot = createBot(process.env.BOT_TOKEN);

// 🕒 Deferred initialization for MatchStartWatcher
(async () => {
  try {
    const { scheduleMatchStartWatchers } = await import("../cron/MatchStartWatcher.js");

    // Initial schedule
    await scheduleMatchStartWatchers(bot);
    logger.info("🕒 [MatchStartWatcher] Initialized successfully.");

    // Auto-reschedule every hour to catch new matches dynamically
    setInterval(async () => {
      try {
        logger.info("🔁 [MatchStartWatcher] Running hourly reschedule...");
        await scheduleMatchStartWatchers(bot);
        logger.info("✅ [MatchStartWatcher] Hourly reschedule completed.");
      } catch (err) {
        logger.error(`⚠️ [MatchStartWatcher] Hourly reschedule failed: ${err.message}`);
      }
    }, 60 * 60 * 1000);
  } catch (err) {
    logger.error(`❌ [MatchStartWatcher] Initialization failed: ${err.message}`);
  }
})();

// =====================================================
// 📤 Export Bot for External Use
// =====================================================
export default bot;
