// src/bot/commands/poolProof.js
import { query } from "../../db/db.js";

export default function poolProofCommand(bot) {
  bot.command("poolproof", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const matchId = parts[1];
    if (!matchId) return ctx.reply("Usage: /poolproof <matchId>");

    const { rows } = await query(
      `SELECT snapshot_hash, tron_tx_id, locked_at
         FROM pool_locks WHERE match_id=$1 AND market_type='PreMatch'`,
      [matchId]
    );
    if (!rows.length) return ctx.reply("No locked proof found for this match.");

    const r = rows[0];
    await ctx.reply(
      `🔐 *Pre-match Pool Locked*\n` +
      `• Match: ${matchId}\n` +
      `• Locked at: ${r.locked_at}\n` +
      `• Hash (sha256): \`${r.snapshot_hash}\`\n` +
      `• Tron tx: \`${r.tron_tx_id}\`\n` +
      `Verify by recomputing hash of the published snapshot.`,
      { parse_mode: "Markdown" }
    );
  });
}
