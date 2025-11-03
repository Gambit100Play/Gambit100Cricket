// src/tests/testMyBetsHandler.js
import dotenv from "dotenv";
dotenv.config();

import { createBot } from "../bot/bot.js";
import { logger } from "../utils/logger.js";
import { getUserBets } from "../db/db.js";

const TELEGRAM_ID = process.env.TEST_TELEGRAM_ID || 5171349113; // your test Telegram ID

console.log("🧪 [Test] Starting MyBetsHandler Diagnostic Test...");
logger.info("🧪 [Test] Starting MyBetsHandler Diagnostic Test...");

async function runMyBetsTest() {
  try {
    const bot = createBot(process.env.BOT_TOKEN);

    // 🔹 Create a mock Telegram context
    const ctx = {
      from: { id: TELEGRAM_ID, first_name: "TestUser" },
      answerCbQuery: async (msg) => console.log(`💬 [CBQuery] ${msg}`),
      reply: async (text, opts) => {
        console.log("\n💬 BOT REPLY:\n" + text);
        if (opts?.reply_markup)
          console.log(
            "🎛️ Buttons →",
            JSON.stringify(opts.reply_markup.inline_keyboard, null, 2)
          );
      },
    };

    // 🔹 Fetch and print plays directly from DB for transparency
    const plays = await getUserBets(TELEGRAM_ID);
    console.log(
      `📊 [Test] DB returned ${plays?.length || 0} plays for user ${TELEGRAM_ID}`
    );

    // 🔹 Run the actual handler logic
    await bot.myBetsHandler(ctx);

    logger.info("✅ [Test] MyBetsHandler executed successfully.");
    console.log("🏁 [Test] Completed MyBetsHandler Diagnostics.");
  } catch (err) {
    logger.error(`💥 [Test] MyBetsHandler failed: ${err.message}`);
    console.error("❌ [Test] Error:", err);
  }
}

// 🏃 Run the test
runMyBetsTest();
