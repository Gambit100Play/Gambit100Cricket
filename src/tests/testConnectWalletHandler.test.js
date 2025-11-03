/**
 * 🧪 TEST: connectWalletHandler.js (Jest + Offline)
 * --------------------------------------------
 * Simulates Telegram updates for connectWalletHandler
 * without hitting Telegram servers or real DB.
 */

import { jest } from "@jest/globals";
import { logger } from "../utils/logger.js";
import connectWalletHandler from "../bot/handlers/connectWalletHandler.js";
import pkg from "pg";

// ────────────────────────────────────────────────
// 🧱 Mock Environment Setup
// ────────────────────────────────────────────────
beforeAll(() => {
  process.env.PGUSER = "testuser";
  process.env.PGHOST = "localhost";
  process.env.PGDATABASE = "testdb";
  process.env.PGPASSWORD = "testpass";
  process.env.PGPORT = 5432;
  process.env.NETWORK = "shasta";

  const mockDB = {
    data: {},
    async query(sql, params) {
      const [telegramId, depositAddress] = params || [];
      if (sql.includes("SELECT")) {
        return { rows: [mockDB.data[telegramId] || {}] };
      }
      if (sql.includes("INSERT INTO")) {
        mockDB.data[telegramId] = {
          deposit_address: depositAddress,
          last_balance_trx: 10,
          last_balance_usdt: 25,
        };
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  pkg.Pool = function MockPool() {
    return {
      connect: async () => ({
        query: (...args) => mockDB.query(...args),
        release: () => {},
      }),
    };
  };

  // Silence logger during tests
  logger.info = jest.fn();
  logger.error = jest.fn();
  logger.debug = jest.fn();
  logger.warn = jest.fn();
});

// ────────────────────────────────────────────────
// 🧩 Mock Bot and Context
// ────────────────────────────────────────────────
class MockBot {
  constructor() {
    this.handlers = {};
    this.logs = [];
  }

  action(trigger, fn) {
    this.handlers[trigger] = fn;
  }

  async handleUpdate(update) {
    const data = update.callback_query?.data;
    const handler = this.handlers[data];
    if (!handler) throw new Error(`⚠️ No handler for ${data}`);

    const ctx = mockCtx(data, this.logs);
    await handler(ctx);
  }
}

function mockCtx(action, logs) {
  return {
    from: { id: "9999", first_name: "TestUser" },
    answerCbQuery: async () => {},
    editMessageText: async (text) => logs.push(text),
    reply: async (text) => logs.push(text),
    callbackQuery: { data: action },
    update: { update_id: 1, message: { text: "/start" } },
  };
}

// ────────────────────────────────────────────────
// 🧩 Shared Setup
// ────────────────────────────────────────────────
let bot;
beforeEach(() => {
  bot = new MockBot();
  connectWalletHandler(bot);
});

// ────────────────────────────────────────────────
// ✅ TEST SUITE
// ────────────────────────────────────────────────
describe("connectWalletHandler", () => {
  test("responds to wallet_menu", async () => {
    await bot.handleUpdate({ callback_query: { data: "wallet_menu", from: { id: "9999" } } });
    const response = bot.logs.join("\n");
    expect(response).toMatch(/Your CricPredict Wallet/);
  });

  test("generates new deposit address", async () => {
    await bot.handleUpdate({ callback_query: { data: "get_deposit_address", from: { id: "9999" } } });
    const response = bot.logs.join("\n");
    expect(response).toMatch(/Your Deposit Address/);
    expect(response).toMatch(/T[A-Za-z0-9]{33}/);
  });

  test("shows balance correctly", async () => {
    await bot.handleUpdate({ callback_query: { data: "check_balance", from: { id: "9999" } } });
    const response = bot.logs.join("\n");
    expect(response).toMatch(/Your Wallet Overview/);
    expect(response).toMatch(/TRX/);
    expect(response).toMatch(/USDT/);
  });

  test("handles back_to_main gracefully", async () => {
    await expect(
      bot.handleUpdate({ callback_query: { data: "back_to_main", from: { id: "9999" } } })
    ).resolves.not.toThrow();
  });
});

// ────────────────────────────────────────────────
// 🧹 Graceful Teardown (closes open handles)
// ────────────────────────────────────────────────
afterAll(async () => {
  // Flush mocked Pool connections if any linger
  if (pkg?.Pool?._clients) pkg.Pool._clients = [];

  // Tiny delay ensures all microtasks finish before Jest exits
  await new Promise((resolve) => setTimeout(resolve, 50));
});
