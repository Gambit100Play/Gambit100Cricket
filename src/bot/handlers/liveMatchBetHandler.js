// src/bot/handlers/liveMatchBetHandler.js
import { Markup } from "telegraf";
import { getMatchById, placeBetWithDebit } from "../../db/db.js";
import { DateTime } from "luxon";

// 🧩 Helper: convert UTC → IST
function formatStartIST(input) {
  if (!input) return "TBA";
  let dt;
  if (input instanceof Date) dt = DateTime.fromJSDate(input);
  else if (typeof input === "string")
    dt = input.includes("T") ? DateTime.fromISO(input) : DateTime.fromSQL(input);
  else if (typeof input === "number") dt = DateTime.fromMillis(input);
  if (!dt || !dt.isValid) return "Invalid Time";
  return dt.setZone("Asia/Kolkata").toFormat("dd LLL yyyy, hh:mm a");
}

// 🏁 Helper: team flags
function getFlag(teamName = "") {
  const name = teamName.toLowerCase();
  if (name.includes("india")) return "🇮🇳";
  if (name.includes("australia")) return "🇦🇺";
  if (name.includes("england")) return "🏴";
  if (name.includes("pakistan")) return "🇵🇰";
  if (name.includes("bangladesh")) return "🇧🇩";
  if (name.includes("sri lanka")) return "🇱🇰";
  if (name.includes("new zealand")) return "🇳🇿";
  if (name.includes("south africa")) return "🇿🇦";
  if (name.includes("afghanistan")) return "🇦🇫";
  if (name.includes("west indies")) return "🇮🇳🇪🇸";
  if (name.includes("nepal")) return "🇳🇵";
  if (name.includes("usa")) return "🇺🇸";
  return "🏏";
}

// 🧠 Cache for awaiting stake input
const waitingForStake = new Map();

export default function liveMatchBetHandler(bot) {
  // 🎯 Entry — user taps a live match
  bot.action(/live_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const matchId = ctx.match[1];
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found or has expired.");

    // Extract teams
    let teamA = "Team A";
    let teamB = "Team B";
    let payload;
    try {
      payload =
        typeof match.api_payload === "object" && match.api_payload !== null
          ? match.api_payload
          : JSON.parse(match.api_payload);
      if (Array.isArray(payload.teams) && payload.teams.length === 2)
        [teamA, teamB] = payload.teams;
    } catch (err) {
      console.warn("⚠️ Could not parse api_payload:", err.message);
    }

    const teamAFlag = getFlag(teamA);
    const teamBFlag = getFlag(teamB);
    const status = match.status?.toLowerCase() || "";

    // If match is not live yet
    if (!status.includes("live")) {
      const when = formatStartIST(match.start_time);
      return ctx.reply(
        `🕓 *${teamAFlag} ${teamA} vs ${teamBFlag} ${teamB}* isn’t live yet.\n📅 Scheduled: ${when} IST`,
        { parse_mode: "Markdown" }
      );
    }

    const scoreInfo = match.score || "Not available";
    const venue = payload?.venue || "Unknown";
    const format = payload?.matchType || "Unknown";
    const time = formatStartIST(match.start_time);

    const header =
      `🔴 *Live Predictions* — ${teamAFlag} ${teamA} vs ${teamBFlag} ${teamB}\n\n` +
      `📊 *Score:* ${scoreInfo}\n` +
      `🏟️ *Venue:* ${venue}\n` +
      `🧾 *Format:* ${format}\n` +
      `🕒 *Started:* ${time} IST\n\n` +
      `🎯 *Choose your live prediction market:*`;

    await ctx.reply(header, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        // 🏏 Runs Market — every 5 overs
        [
          Markup.button.callback("🔥 Next 5 Overs: Over 40.5 Runs", `live_runs_over_${matchId}`),
          Markup.button.callback("❄️ Next 5 Overs: Under 40.5 Runs", `live_runs_under_${matchId}`),
        ],

        // 🎯 Wickets Market — every 2 overs
        [
          Markup.button.callback("🎯 Wicket in Next 2 Overs: YES", `live_wicket_yes_${matchId}`),
          Markup.button.callback("🚫 Wicket in Next 2 Overs: NO", `live_wicket_no_${matchId}`),
        ],

        // 💥 Boundaries (4s+6s)
        [
          Markup.button.callback("💥 Next 2 Overs: Over 2.5 Boundaries", `live_bounds_over_${matchId}`),
          Markup.button.callback("❄️ Next 2 Overs: Under 2.5 Boundaries", `live_bounds_under_${matchId}`),
        ],

        // 6️⃣ Sixes
        [
          Markup.button.callback("💣 Next 2 Overs: Over 1.5 Sixes", `live_six_over_${matchId}`),
          Markup.button.callback("📉 Next 2 Overs: Under 1.5 Sixes", `live_six_under_${matchId}`),
        ],

        // 4️⃣ Fours
        [
          Markup.button.callback("🔥 Next 2 Overs: Over 2.5 Fours", `live_four_over_${matchId}`),
          Markup.button.callback("❄️ Next 2 Overs: Under 2.5 Fours", `live_four_under_${matchId}`),
        ],

        // Misc
        [
          Markup.button.callback("📊 Match Insights", `live_info_${matchId}`),
          Markup.button.callback("🔙 Back", "matches"),
        ],
      ]),
    });
  });

  // =============== 🧠 Unified Market Logic ===============

  const setStakeWait = async (ctx, matchId, marketType, betOption, segmentDuration, message) => {
    const match = await getMatchById(matchId);
    if (!match) return ctx.reply("❌ Match not found.");

    waitingForStake.set(ctx.from.id, {
      matchId,
      matchName: match.name,
      betOption,
      betType: "Live",
      marketType,
      segmentDuration,
    });

    return ctx.reply(message, { parse_mode: "Markdown" });
  };

  // 🏏 Runs (5 overs)
  bot.action(/live_runs_over_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_runs",
      "Over 40.5 Runs",
      5,
      "🔥 *Next 5 Overs — Over 40.5 Runs*\n💰 Enter your stake amount (in G-Tokens):"
    );
  });

  bot.action(/live_runs_under_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_runs",
      "Under 40.5 Runs",
      5,
      "❄️ *Next 5 Overs — Under 40.5 Runs*\n💰 Enter your stake amount (in G-Tokens):"
    );
  });

  // 🎯 Wickets (2 overs)
  bot.action(/live_wicket_yes_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_wicket",
      "Wicket in Next 2 Overs: YES",
      2,
      "🎯 Predict *YES*: A wicket will fall in the next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  bot.action(/live_wicket_no_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_wicket",
      "Wicket in Next 2 Overs: NO",
      2,
      "🚫 Predict *NO*: No wicket will fall in the next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  // 💥 Boundaries
  bot.action(/live_bounds_over_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_bounds",
      "Over 2.5 Boundaries",
      2,
      "💥 Predict *Over 2.5 Boundaries* in next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  bot.action(/live_bounds_under_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_bounds",
      "Under 2.5 Boundaries",
      2,
      "❄️ Predict *Under 2.5 Boundaries* in next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  // 6️⃣ Sixes
  bot.action(/live_six_over_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_six",
      "Over 1.5 Sixes",
      2,
      "💣 Predict *Over 1.5 Sixes* in next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  bot.action(/live_six_under_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_six",
      "Under 1.5 Sixes",
      2,
      "📉 Predict *Under 1.5 Sixes* in next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  // 4️⃣ Fours
  bot.action(/live_four_over_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_four",
      "Over 2.5 Fours",
      2,
      "🔥 Predict *Over 2.5 Fours* in next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  bot.action(/live_four_under_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await setStakeWait(
      ctx,
      ctx.match[1],
      "live_four",
      "Under 2.5 Fours",
      2,
      "❄️ Predict *Under 2.5 Fours* in next 2 overs.\n💰 Enter your stake amount:"
    );
  });

  // 📊 Match Info
  bot.action(/live_info_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const match = await getMatchById(ctx.match[1]);
    const payload =
      typeof match.api_payload === "object" && match.api_payload !== null
        ? match.api_payload
        : JSON.parse(match.api_payload);

    const venue = payload.venue || "Unknown";
    const format = payload.matchType || "Unknown";
    const series = payload.series_name || "N/A";
    const time = formatStartIST(match.start_time);

    await ctx.reply(
      `📊 *Live Match Insights*\n\n` +
        `🏟️ *Venue:* ${venue}\n` +
        `🧾 *Format:* ${format}\n` +
        `🏆 *Series:* ${series}\n` +
        `🕒 *Started:* ${time} IST\n` +
        `🎯 *Status:* ${match.status}\n\n` +
        `Data provided by *CricAPI* ✅`,
      { parse_mode: "Markdown" }
    );
  });

  // ===================== 💰 STAKE INPUT HANDLER =====================
  bot.on("text", async (ctx) => {
    const telegramId = ctx.from.id;
    const stakeInfo = waitingForStake.get(telegramId);
    if (!stakeInfo) return; // not waiting for stake

    const stake = parseFloat(ctx.message.text);
    if (isNaN(stake) || stake <= 0) {
      return ctx.reply("⚠️ Please enter a valid numeric stake amount.");
    }

    try {
      const { bet } = await placeBetWithDebit({
        telegramId,
        matchId: stakeInfo.matchId,
        matchName: stakeInfo.matchName,
        betType: stakeInfo.betType,
        betOption: stakeInfo.betOption,
        stake,
        marketType: stakeInfo.marketType,
        segmentDuration: stakeInfo.segmentDuration,
      });

      waitingForStake.delete(telegramId);
      await ctx.reply(
        `✅ *Bet Placed Successfully!*\n\n` +
          `🏏 *${stakeInfo.matchName}*\n` +
          `🎯 *${stakeInfo.betOption}*\n` +
          `💸 Stake: *${stake} G-Tokens*\n` +
          `📊 Market: *${stakeInfo.marketType}* (${stakeInfo.segmentDuration} overs)\n\n` +
          `Best of luck 🍀 — results after this segment!`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("❌ [LiveBet] Error:", err);
      ctx.reply("❌ Bet could not be placed. Please try again.");
    }
  });
}
