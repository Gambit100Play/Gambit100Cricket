// =======================================================
// 🚦 Redis Rate Limiting (Token Bucket Style)
// =======================================================
import { redis } from "./index.js";

export async function rateLimit(key, limit, windowSec) {
  const bucketKey = `rate:${key}`;

  const count = await redis.incr(bucketKey);

  if (count === 1) {
    await redis.expire(bucketKey, windowSec);
  }

  return count <= limit;  // true = allowed
}
