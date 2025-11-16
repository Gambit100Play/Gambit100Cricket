
// src/redis/locks.js
// =======================================================
// 🔐 Redis Distributed Locks
// =======================================================
import { redis } from "./index.js";

export async function acquireLock(key, ttl = 3000) {
  const lockKey = `lock:${key}`;

  const result = await redis.set(lockKey, "1", {
    NX: true,          // only set if not exists
    PX: ttl            // expire automatically
  });

  return result === "OK";  // true = lock acquired
}

export async function releaseLock(key) {
  const lockKey = `lock:${key}`;
  await redis.del(lockKey);
}

export async function withLock(key, ttl, fn) {
  const ok = await acquireLock(key, ttl);
  if (!ok) return false;

  try {
    return await fn();
  } finally {
    await releaseLock(key);
  }
}
