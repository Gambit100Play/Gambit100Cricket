// =============================================================
// ⚡ Deterministic Deposit Address Manager (Option 2)
// =============================================================
import { Pool } from "pg";
import dotenv from "dotenv";
import { logger } from "./logger.js";
import { deriveAddressForIndex } from "./wallet.js";

dotenv.config();

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

/**
 * Get or create a deterministic TRON deposit address for a user.
 * No private keys are stored anywhere.
 */
export async function getOrCreateDepositAddress(telegramId) {
  const client = await pool.connect();

  try {
    // 0️⃣ Ensure the derivation index tracker table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_sequence (
        id SERIAL PRIMARY KEY
      );
    `);

    // 1️⃣ Check if user already has a deposit address
    const { rows: existing } = await client.query(
      `SELECT deposit_address, derivation_index FROM users WHERE telegram_id = $1`,
      [telegramId]
    );

    if (existing.length) {
      const row = existing[0];
      return { address: row.deposit_address, derivationIndex: row.derivation_index };
    }

    // 2️⃣ Allocate new derivation index atomically
    const { rows: seqRows } = await client.query(`
      INSERT INTO wallet_sequence DEFAULT VALUES
      RETURNING id AS next_index;
    `);
    const index = seqRows[0].next_index;

    // 3️⃣ Derive address deterministically from master mnemonic
    const { address, path } = deriveAddressForIndex(index);

    // 4️⃣ Save to users table (no private key storage)
    await client.query(
      `UPDATE users
          SET deposit_address = $1, derivation_index = $2
        WHERE telegram_id = $3`,
      [address, index, telegramId]
    );

    logger.info(
      `🆕 [DepositAddress] Created TRON address for user=${telegramId}, index=${index}, path=${path}, address=${address}`
    );

    return { address, derivationIndex: index };
  } catch (err) {
    logger.error(`❌ [DepositAddress] ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

export default getOrCreateDepositAddress;
