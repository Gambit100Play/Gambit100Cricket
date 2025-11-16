//src/redis/poolCache.js

// ==================================================================
// 🏊 poolCache.js — Dedicated Redis Cache for Pool + Odds System
// ==================================================================

import redis from "./index.js";
import { logger } from "../utils/logger.js";

// TTLs (in seconds)
const TTL_INFO = 2;      // poolinfo cache
const TTL_SUMMARY = 3;   // poolsummary cache
const TTL_ODDS = 3;      // dynamic odds cache
const TTL_STATUS = 2;    // pool status cache

// --------------------------------------------------------------
// 🔥 Build Keys (namespaced safely)
// --------------------------------------------------------------
export const poolKey = {
  info: (matchId, type, opt = null) =>
    opt
      ? `poolinfo:${matchId}:${type}:${opt}`
      : `poolinfo:${matchId}:${type}`,

  summary: (matchId, type) => `poolsummary:${matchId}:${type}`,
  odds: (matchId, type) => `odds:${matchId}:${type}`,
  status: (matchId, type) => `poolstatus:${matchId}:${type}`,
};

// --------------------------------------------------------------
// 🧠 Get Cached Value (auto-JSON decode)
// --------------------------------------------------------------
export async function poolCacheGet(key) {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`⚠️ [poolCacheGet] Failed for ${key}: ${err.message}`);
    return null;
  }
}

// --------------------------------------------------------------
// 💾 Set Cached Value (auto-JSON encode)
// --------------------------------------------------------------
export async function poolCacheSet(key, data, ttl = 2) {
  try {
    await redis.set(key, JSON.stringify(data), { EX: ttl });
  } catch (err) {
    logger.warn(`⚠️ [poolCacheSet] Failed for ${key}: ${err.message}`);
  }
}

// --------------------------------------------------------------
// 🗑 Delete Key
// --------------------------------------------------------------
export async function poolCacheDel(key) {
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn(`⚠️ [poolCacheDel] Failed for ${key}: ${err.message}`);
  }
}

// --------------------------------------------------------------
// 🧹 Bulk Invalidate all relevant keys for pool update
// --------------------------------------------------------------
export async function invalidatePoolCache(matchId, type = "prematch") {
  const t = type.toLowerCase();

  const keys = [
    poolKey.info(matchId, t),
    poolKey.summary(matchId, t),
    poolKey.odds(matchId, t),
    poolKey.status(matchId, t),
  ];

  // Delete all single-option poolinfo keys too:
  try {
    const optKeys = await redis.keys(`poolinfo:${matchId}:${t}:*`);
    keys.push(...optKeys);
  } catch {}

  for (const k of keys) {
    await poolCacheDel(k);
  }
}

export default {
  poolCacheGet,
  poolCacheSet,
  poolCacheDel,
  invalidatePoolCache,
  poolKey,
};
