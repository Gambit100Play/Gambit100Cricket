import dotenv from "dotenv";
dotenv.config();

// ────────────────────────────────────────────────
// ✅ Handle TronWeb import (CJS + ESM safe)
// ────────────────────────────────────────────────
import * as TronWebPkg from "tronweb";
const TronWeb = TronWebPkg.TronWeb || TronWebPkg.default || TronWebPkg;

// ────────────────────────────────────────────────
// 📚 HD Wallet dependencies
// ────────────────────────────────────────────────
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { logger } from "./logger.js";

// ────────────────────────────────────────────────
// ⚙️ Network setup
// ────────────────────────────────────────────────
const NETWORK = (process.env.NETWORK || "mainnet").toLowerCase();
const IS_SHASTA = NETWORK === "shasta";

export const tronWeb = new TronWeb({
  fullHost: IS_SHASTA ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io",
  headers: process.env.TRONGRID_API_KEY
    ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
    : undefined,
  privateKey: process.env.TRON_PRIVATE_KEY || undefined,
});

logger.info(`🌐 Tron network initialized → ${IS_SHASTA ? "Shasta Testnet" : "Mainnet"}`);

// ────────────────────────────────────────────────
// 🧠 Validate master mnemonic
// ────────────────────────────────────────────────
let MASTER_MNEMONIC = (process.env.MASTER_MNEMONIC || "")
  .replace(/^["']+|["']+$/g, "")
  .replace(/\s+/g, " ")
  .trim();

if (!MASTER_MNEMONIC) throw new Error("❌ MASTER_MNEMONIC missing in .env");

if (!validateMnemonic(MASTER_MNEMONIC, wordlist)) {
  throw new Error("❌ Invalid MASTER_MNEMONIC — checksum failed");
}
logger.info("✅ Master mnemonic validated successfully.");

// ────────────────────────────────────────────────
// 🔐 Derive TRON HD wallet (BIP-44: m/44'/195'/0'/0/index)
// ────────────────────────────────────────────────
export function deriveAddressForIndex(index) {
  if (!Number.isInteger(index) || index < 0)
    throw new Error(`❌ Invalid derivation index: ${index}`);

  // 1️⃣ Generate master seed
  const seed = mnemonicToSeedSync(MASTER_MNEMONIC);

  // 2️⃣ Derive path for TRON (195)
  const root = HDKey.fromMasterSeed(seed);
  const path = `m/44'/195'/0'/0/${index}`;
  const child = root.derive(path);

  if (!child.privateKey) throw new Error(`❌ No private key derived at index ${index}`);

  // 3️⃣ Convert to hex & get TRON address
  const privHex = Buffer.from(child.privateKey).toString("hex");
  const pubAddr = tronWeb.utils.crypto.getBase58CheckAddress(
    tronWeb.utils.crypto.computeAddress(privHex)
  );

  logger.debug(`🧩 Derived TRON address ${pubAddr} (path: ${path})`);
  return { index, address: pubAddr, privHex, path };
}

// ────────────────────────────────────────────────
// 👤 Deterministic deposit address per Telegram user
// ────────────────────────────────────────────────
export function getAddressForUser(telegramId) {
  if (!telegramId) throw new Error("telegramId required");

  // Telegram IDs are large integers; reduce deterministically but safely
  const numericIndex = Math.abs(Number(String(telegramId).replace(/\D/g, ""))) % 1_000_000;

  const { address } = deriveAddressForIndex(numericIndex);

  logger.info(`🎯 Derived deterministic TRON deposit address for ${telegramId}: ${address}`);
  return address;
}

// ────────────────────────────────────────────────
// 🧱 Export both the instance and derivation methods
// ────────────────────────────────────────────────
export default {
  tronWeb,
  deriveAddressForIndex,
  getAddressForUser,
};
