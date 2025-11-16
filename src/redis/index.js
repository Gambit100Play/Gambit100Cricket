// =======================================================
// 🚀 Redis Client (Unified Production Client)
// =======================================================
import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redis = createClient({
  url: REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error("Redis reconnect limit reached");
      return Math.min(retries * 200, 3000);
    }
  }
});

redis.on("connect", () => console.log("🔌 [Redis] Connected"));
redis.on("reconnecting", () => console.log("♻️ [Redis] Reconnecting..."));
redis.on("error", (err) => console.error("❌ [Redis] Error:", err));

await redis.connect();

export default redis;
