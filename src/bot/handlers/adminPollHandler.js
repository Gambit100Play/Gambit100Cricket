// src/bot/handlers/adminPollHandler.js

import { Markup } from "telegraf";
import { query } from "../../db/db.js";

const ADMIN_ID = 5171349113;

export default function adminPollHandler(bot) {
  // 🧩 CREATE POLL
  bot.command("createpoll", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const question = ctx.message.text.split(" ").slice(1).join(" ");
    if (!question)
      return ctx.reply("Usage: /createpoll <question>");

    try {
      const poolRes = await query(
        `INSERT INTO pools (matchid, pool_type, status, is_locked, participants, total_stake)
         VALUES (0, 'Consensus', 'open', false, 0, 0)
         RETURNING id;`
      );

      const poolId = poolRes.rows[0].id;

      await query(
        `INSERT INTO poll_questions (pool_id, question) VALUES ($1, $2)`,
        [poolId, question]
      );

      ctx.reply(
        `🧠 Consensus Poll #${poolId} Created!\n\n${question}\n\nNow add options using /addoption ${poolId} <option text>\n\nStatus: OPEN — will change to PENDING after 24 hours.`
      );
    } catch (err) {
      console.error("[CreatePoll] Error:", err);
      ctx.reply("Failed to create poll. Check logs.");
    }
  });

  // ➕ ADD OPTION
  bot.command("addoption", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const parts = ctx.message.text.split(" ");
    const poolId = parts[1];
    const optionText = parts.slice(2).join(" ");

    if (!poolId || !optionText)
      return ctx.reply("Usage: /addoption <pool_id> <option text>");

    try {
      await query(
        `INSERT INTO options (pool_id, text) VALUES ($1, $2)`,
        [poolId, optionText]
      );
      ctx.reply(`Added option to poll ${poolId}: ${optionText}`);
    } catch (err) {
      console.error("[AddOption] Error:", err);
      ctx.reply("Failed to add option. Check logs.");
    }
  });

  // 📢 SHOW POLL TO USERS
  bot.command("showpoll", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const parts = ctx.message.text.split(" ");
    const poolId = parts[1];
    if (!poolId) return ctx.reply("Usage: /showpoll <pool_id>");

    try {
      const questionRes = await query(
        `SELECT question FROM poll_questions WHERE pool_id = $1`,
        [poolId]
      );
      if (!questionRes.rows.length)
        return ctx.reply("No question found for this poll.");

      const optionsRes = await query(
        `SELECT id, text FROM options WHERE pool_id = $1`,
        [poolId]
      );
      if (!optionsRes.rows.length)
        return ctx.reply("No options yet! Add some first.");

      const buttons = optionsRes.rows.map((o) => [
        Markup.button.callback(o.text, `vote_${poolId}_${o.id}`),
      ]);

      await ctx.reply(`${questionRes.rows[0].question}\n\nVote below:`, {
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (err) {
      console.error("[ShowPoll] Error:", err);
      ctx.reply("Could not display poll. Check logs.");
    }
  });

  // 🗳 VOTING HANDLER
  bot.action(/^vote_(\d+)_(\d+)$/, async (ctx) => {
    const [, poolId, optionId] = ctx.match;
    const telegramId = ctx.from.id;

    try {
      const existing = await query(
        `SELECT 1 FROM bets WHERE pool_id=$1 AND telegram_id=$2`,
        [poolId, telegramId]
      );
      if (existing.rows.length)
        return ctx.answerCbQuery("You already voted.");

      await query(
        `INSERT INTO bets (telegram_id, pool_id, option_id, stake)
         VALUES ($1, $2, $3, 1)`,
        [telegramId, poolId, optionId]
      );

      await query(
        `UPDATE pools SET participants = participants + 1 WHERE id = $1`,
        [poolId]
      );

      ctx.answerCbQuery("Vote registered!");
    } catch (err) {
      console.error("[Vote] Error:", err);
      ctx.answerCbQuery("Could not register vote.");
    }
  });

  // 🏁 CLOSE POLL
  bot.command("closepoll", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const poolId = ctx.message.text.split(" ")[1];
    if (!poolId) return ctx.reply("Usage: /closepoll <pool_id>");

    try {
      const results = await query(
        `SELECT option_id, COUNT(*) as votes
         FROM bets
         WHERE pool_id = $1
         GROUP BY option_id
         ORDER BY votes DESC;`,
        [poolId]
      );

      if (!results.rows.length)
        return ctx.reply("No votes recorded for this poll.");

      if (
        results.rows.length > 1 &&
        results.rows[0].votes === results.rows[1].votes
      ) {
        await query(`UPDATE pools SET status='draw' WHERE id=$1`, [poolId]);
        return ctx.reply("It's a tie! Poll marked as draw.");
      }

      const winner = results.rows[0];
      await query(
        `UPDATE pools SET status='completed', winning_option=$1 WHERE id=$2`,
        [winner.option_id, poolId]
      );

      const winnerText = await query(
        `SELECT text FROM options WHERE id=$1`,
        [winner.option_id]
      );

      ctx.reply(
        `Poll ${poolId} closed!\nWinning option: ${winnerText.rows[0].text} with ${winner.votes} votes.`
      );
    } catch (err) {
      console.error("[ClosePoll] Error:", err);
      ctx.reply("Failed to close poll. Check logs.");
    }
  });
}
