import { getAndClearPendingBets } from "../db/cache.js";
import { placeBetWithDebit } from "../db/db.js";

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
