import { Pool } from "pg";
import crypto from "crypto";
import dotenv from "dotenv";
import { logger } from "./logger.js";
import { deriveAddressForIndex } from "./wallet.js";

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
// 🔒 AES-256-GCM encryption helper
// ──────────────────────────────────────────────
function encryptKey(plain) {
  if (!plain) throw new Error("Missing private key for encryption");

  const baseKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!baseKey) throw new Error("MASTER_ENCRYPTION_KEY not set in .env");

  try {
    const key = Buffer.from(baseKey, "base64");
    if (key.length !== 32)
      throw new Error("MASTER_ENCRYPTION_KEY must decode to 32 bytes");

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString("base64");
  } catch (err) {
    logger.error(`❌ [encryptKey] ${err.message}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// 👤 Create or fetch deterministic TRON wallet
// ──────────────────────────────────────────────
export async function getOrCreateDepositAddress(telegramId) {
  const client = await pool.connect();
  try {
    // 0️⃣ Ensure wallet_sequence exists (safe for new deployments)
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_sequence (
        id SERIAL PRIMARY KEY
      );
    `);

    // 1️⃣ Fetch existing wallet
    const existing = await client.query(
      `SELECT deposit_address, encrypted_privkey, derivation_index
         FROM user_wallets
        WHERE telegram_id = $1`,
      [telegramId]
    );

    if (existing.rows.length) {
      const row = existing.rows[0];

      // Normalize any legacy JSON addresses
      if (typeof row.deposit_address === "string" && row.deposit_address.startsWith("{")) {
        try {
          const parsed = JSON.parse(row.deposit_address);
          if (parsed?.address) {
            row.deposit_address = parsed.address;

            await client.query(
              `UPDATE user_wallets SET deposit_address=$1 WHERE telegram_id=$2`,
              [row.deposit_address, telegramId]
            );
            await client.query(
              `UPDATE users SET deposit_address=$1 WHERE telegram_id=$2`,
              [row.deposit_address, telegramId]
            );
            logger.info(`🧹 [DepositAddress] Cleaned legacy JSON for user=${telegramId}`);
          }
        } catch {
          logger.warn(`⚠️ [DepositAddress] Failed to parse legacy JSON for user=${telegramId}`);
        }
      }

      // Ensure return is a plain string
      let address = row.deposit_address;
      if (typeof address === "object" && address?.address) {
        address = address.address;
      }

      return {
        address,
        encryptedKey: row.encrypted_privkey || null,
        derivationIndex: row.derivation_index || null,
      };
    }

    // 2️⃣ Allocate new derivation index atomically
    const { rows: seqRows } = await client.query(`
      INSERT INTO wallet_sequence DEFAULT VALUES
      RETURNING id AS next_index;
    `);
    const index = seqRows[0].next_index;

    // 3️⃣ Derive wallet deterministically
    const { address, privHex, path } = deriveAddressForIndex(index);

    // 4️⃣ Encrypt private key
    const encryptedPriv = encryptKey(privHex);

    // 5️⃣ Persist new wallet
    await client.query(
      `INSERT INTO user_wallets
        (telegram_id, deposit_address, encrypted_privkey, derivation_index, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [telegramId, address, encryptedPriv, index]
    );

    logger.info(
      `🆕 [DepositAddress] Created TRON wallet → user=${telegramId} index=${index} path=${path} address=${address}`
    );

    return { address, encryptedKey: encryptedPriv, derivationIndex: index };
  } catch (err) {
    logger.error(`❌ [DepositAddress] ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

export default getOrCreateDepositAddress;
