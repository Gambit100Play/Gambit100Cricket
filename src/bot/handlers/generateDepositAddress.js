// src/bot/handlers/generateDepositAddress.js
import { Pool } from "pg";
import crypto from "crypto";
import dotenv from "dotenv";
import { logger } from "../../utils/logger.js";
import { getAddressForUser, deriveAddressForIndex } from "../../utils/wallet.js";  // ✅ use canonical wallet utils

dotenv.config();

// ──────────────────────────────────────────────
// 🗄 PostgreSQL connection pool
// ──────────────────────────────────────────────
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// ──────────────────────────────────────────────
// 🔒 AES-256-GCM encryption (optional local vault)
// ──────────────────────────────────────────────
function encryptKey(plain) {
  try {
    logger.debug("🔐 Encrypting derived private key…");
    const key = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, "base64");
    if (key.length !== 32)
      throw new Error("MASTER_ENCRYPTION_KEY must decode to 32 bytes (AES-256 key).");

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const result = Buffer.concat([iv, tag, ct]).toString("base64");
    logger.debug("✅ Encryption successful.");
    return result;
  } catch (err) {
    logger.error(`❌ Encryption failed: ${err.message}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// 👤 Create or fetch deposit address for a Telegram user
// ──────────────────────────────────────────────
export async function getOrCreateDepositAddress(telegramId) {
  logger.info(`🔁 [DepositAddress] Request for user ${telegramId}`);
  const client = await pool.connect();

  try {
    // 1️⃣  Check if address already exists
    const existing = await client.query(
      "SELECT deposit_address FROM user_wallets WHERE telegram_id=$1",
      [telegramId]
    );

    if (existing.rows.length) {
      const addr = existing.rows[0].deposit_address;
      logger.info(`🔄 Existing deposit address for ${telegramId}: ${addr}`);
      return addr;
    }

    // 2️⃣  Derive address from canonical wallet logic
    const tronAddress = getAddressForUser(telegramId);
    const { privHex } = deriveAddressForIndex(
      Math.abs(Number(String(telegramId).replace(/\D/g, ""))) % 1_000_000
    );

    // 3️⃣  Encrypt private key (for optional local vault)
    const encrypted = encryptKey(privHex);

    // 4️⃣  Store new address in database
    await client.query(
      "INSERT INTO user_wallets (telegram_id, deposit_address) VALUES ($1,$2)",
      [telegramId, tronAddress]
    );

    logger.info(`✅ Stored new TRON deposit address for ${telegramId}: ${tronAddress}`);

    // (Optional) save encrypted key locally for dev
    // fs.writeFileSync(`vault/${telegramId}.json`,
    //   JSON.stringify({ address: tronAddress, encrypted }), "utf8");
    // logger.debug(`🔒 Encrypted key saved to vault/${telegramId}.json`);

    return tronAddress;
  } catch (err) {
    logger.error(`❌ Failed to create deposit address for ${telegramId}: ${err.message}`);
    throw err;
  } finally {
    client.release();
    logger.debug(`🔚 DB connection released for ${telegramId}`);
  }
}
