// =======================================================
// ⚡ Redis Caching Utilities
// =======================================================
import { redis } from "./index.js";

export async function cacheGet(key) {
  const raw = await redis.get(key);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
}

export async function cacheSet(key, value, ttl = 60) {
  const data = typeof value === "string" ? value : JSON.stringify(value);

  await redis.set(key, data, {
    EX: ttl // expire in seconds
  });

  return true;
}

export async function cacheDelete(key) {
  await redis.del(key);
}

export async function cacheWrap(key, ttl, fn) {
  const cached = await cacheGet(key);
  if (cached) return cached;

  const fresh = await fn();
  await cacheSet(key, fresh, ttl);
  return fresh;
}
