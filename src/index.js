import dotenv from "dotenv";
import { createBot } from "./bot/bot.js";

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("❌ BOT_TOKEN missing in .env file");

const bot = createBot(token);

bot.launch()
  .then(() => console.log("🚀 Bot launched successfully and is polling for updates..."))
  .catch((err) => console.error("❌ Bot launch failed:", err));

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
