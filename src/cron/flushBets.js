import { getAndClearPendingBets } from "../db/cache.js";
import { placeBet } from "../db/db.js";

export async function flushPendingBets(telegramId) {
  const stagedBets = await getAndClearPendingBets(telegramId);
  for (const bet of stagedBets) {
    await placeBet(
      telegramId,
      bet.matchId,
      bet.matchName,
      bet.type,
      bet.betOption,
      bet.stake
    );
  }
}
