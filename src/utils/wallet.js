// src/utils/wallet.js
import dotenv from "dotenv";
dotenv.config();

import * as TronWebModule from "tronweb";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { logger } from "./logger.js";

// ────────────────────────────────────────────────
// ⚙️ Initialize TronWeb (Shasta or Mainnet)
// ────────────────────────────────────────────────
const { TronWeb } = TronWebModule;
const NETWORK = (process.env.NETWORK || "mainnet").toLowerCase();
const IS_SHASTA = NETWORK === "shasta";

export const tronWeb = new TronWeb({
  fullHost: IS_SHASTA ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io",
  headers: process.env.TRONGRID_API_KEY
    ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
    : undefined,
  privateKey: process.env.TRON_PRIVATE_KEY || undefined, // optional
});

logger.info(`🌐 Tron network initialized → ${IS_SHASTA ? "Shasta Testnet" : "Mainnet"}`);

// ────────────────────────────────────────────────
// 🧠 Load and sanitize master mnemonic
// ────────────────────────────────────────────────
let MASTER_MNEMONIC = (process.env.MASTER_MNEMONIC || "").trim();

// 🔧 Automatically strip quotes and normalize spaces
MASTER_MNEMONIC = MASTER_MNEMONIC
  .replace(/^["']+|["']+$/g, "")
  .replace(/\s+/g, " ")
  .trim();

if (!MASTER_MNEMONIC) {
  logger.error("❌ Missing MASTER_MNEMONIC in .env file!");
  throw new Error("MASTER_MNEMONIC is required for HD derivation.");
}

// 🧩 Validate against the English wordlist
if (!validateMnemonic(MASTER_MNEMONIC, wordlist)) {
  logger.error(`❌ Invalid MASTER_MNEMONIC detected: ${MASTER_MNEMONIC}`);
  logger.error(
    "💡 Hint: If you’re using Windows, remove quotes in .env OR let this sanitizer clean it.\n" +
    "If it still fails, generate a valid 12-word BIP-39 mnemonic:\n" +
    "node --input-type=module -e \"import { generateMnemonic } from '@scure/bip39'; import { wordlist } from '@scure/bip39/wordlists/english.js'; console.log(generateMnemonic(wordlist));\""
  );
  throw new Error("Invalid MASTER_MNEMONIC – failed BIP-39 checksum validation.");
}

logger.info("✅ Master mnemonic validated successfully.");

// ────────────────────────────────────────────────
// 🔐 Derive TRON HD wallet address at index (BIP-44, coin=195)
// ────────────────────────────────────────────────
export function deriveAddressForIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid derivation index: ${index}`);
  }

  logger.debug(`🔢 Deriving TRON address for index ${index}...`);
  const seed = mnemonicToSeedSync(MASTER_MNEMONIC);
  const root = HDKey.fromMasterSeed(seed);
  const path = `m/44'/195'/0'/0/${index}`;
  const child = root.derive(path);

  if (!child.privateKey) throw new Error(`No private key derived for index ${index}`);

  const privHex = "0x" + child.privateKey.toString("hex");

  const tronAddress = tronWeb.utils.crypto.getBase58CheckAddress(
    tronWeb.utils.crypto.computeAddress(privHex)
  );

  if (!tronAddress || !tronAddress.startsWith("T")) {
    throw new Error(`Invalid TRON address derived at index ${index}`);
  }

  logger.debug(`✅ Derived TRON address ${tronAddress} (path: ${path})`);
  return { index, tronAddress, privHex, path };
}

// ────────────────────────────────────────────────
// 👤 Deterministic TRC-20 Deposit Address per Telegram User
// ────────────────────────────────────────────────
export function getAddressForUser(telegramId) {
  if (!telegramId) throw new Error("telegramId is required");
  const numericIndex = Math.abs(Number(String(telegramId).replace(/\D/g, ""))) % 1_000_000;
  const { tronAddress } = deriveAddressForIndex(numericIndex);
  logger.info(`🎯 Deterministic TRON deposit address for ${telegramId}: ${tronAddress}`);
  return tronAddress;
}
