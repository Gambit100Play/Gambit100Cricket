import bot from "./bot/bot.js";
import { logger } from "./utils/logger.js";

(async () => {
  try {
    await bot.launch();
    logger.info("🚀 Bot launched successfully and is polling for updates...");
  } catch (err) {
    logger.error(`❌ Bot launch failed: ${err.message}`);
    process.exit(1);
  }
})();
