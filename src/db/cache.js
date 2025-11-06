// import redis from "../utils/redisClient.js";

// ✅ Cache balance
export async function cacheUserBalance(telegramId, balance) {
  await redis.setEx(
    `user:balance:${telegramId}`,
    300, // TTL 5 mins
    JSON.stringify(balance)
  );
}

// ✅ Get balance from cache (fallback to DB)
export async function getCachedUserBalance(telegramId, fallbackFn) {
  const data = await redis.get(`user:balance:${telegramId}`);
  if (data) return JSON.parse(data);

  // fallback: fetch from DB if not cached
  const balance = await fallbackFn(telegramId);
  await cacheUserBalance(telegramId, balance);
  return balance;
}

// ✅ Stage pending bet
export async function stagePendingBet(telegramId, betData) {
  const key = `user:pending_bets:${telegramId}`;
  const existing = JSON.parse((await redis.get(key)) || "[]");
  existing.push(betData);
  await redis.setEx(key, 900, JSON.stringify(existing)); // 15-min expiry
}

// ✅ Confirm all staged bets
export async function getAndClearPendingBets(telegramId) {
  const key = `user:pending_bets:${telegramId}`;
  const data = JSON.parse((await redis.get(key)) || "[]");
  await redis.del(key);
  return data;
}

// ✅ Cache active matches
export async function cacheActiveMatches(matches) {
  await redis.setEx("matches:active", 600, JSON.stringify(matches));
}

export async function getCachedMatches(fallbackFn) {
  const cached = await redis.get("matches:active");
  if (cached) return JSON.parse(cached);
  const matches = await fallbackFn();
  await cacheActiveMatches(matches);
  return matches;
}
