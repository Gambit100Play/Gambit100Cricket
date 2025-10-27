// src/tests/testDb.js
import { createUser, getUserBalance, query } from "../db/db.js";

async function testDb() {
  try {
    console.log("🔄 Testing database connection...");

    // Raw query check
    const result = await query("SELECT NOW()");
    console.log("✅ DB connected. Current time:", result.rows[0].now);

    // Insert a test user
    const telegramId = 111222333; // fake test telegram id
    const username = "TestUser";

    await createUser(telegramId, username);
    console.log(`✅ User ${username} (${telegramId}) created.`);

    // Fetch balance
    const balance = await getUserBalance(telegramId);
    console.log("✅ Balance fetched:", balance);

    console.log("🎉 All DB tests passed successfully.");
  } catch (err) {
    console.error("❌ DB test failed:", err);
  } finally {
    process.exit(); // Exit so script doesn't hang
  }
}

testDb();
