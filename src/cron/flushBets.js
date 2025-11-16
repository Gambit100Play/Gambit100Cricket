// src/cron/flushBets.js
import redis from "../redis/index.js";
import { placeBetWithDebit } from "../db/db.js";

/**
 * Retrieves and clears staged bets for a specific user.
 * Redis structure:
 *    pendingbets:<telegramId>  → list of JSON strings
 */
async function getAndClearPendingBets(telegramId) {
  const key = `pendingbets:${telegramId}`;

  // Get all items
  const rawBets = await redis.lRange(key, 0, -1);

  // Clear the list
  await redis.del(key);

  // Parse safely
  return rawBets.map((b) => {
    try {
      return JSON.parse(b);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Flush all pending bets for a user
 */
export async function flushPendingBets(telegramId) {
  const stagedBets = await getAndClearPendingBets(telegramId);

  for (const bet of stagedBets) {
    await placeBetWithDebit({
      telegramId,
      matchId: bet.matchId,
      matchName: bet.matchName,
      betType: bet.type,
      betOption: bet.betOption,
      stake: bet.stake,
      marketType: "PreMatch",
    });
  }
}
