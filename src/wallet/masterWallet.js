// =============================================================
// 🔐 MASTER WALLET — HD (Hierarchical Deterministic) Wallet Manager
// (v6.2 — Proper BIP-44 Path Derivation for TRON)
// =============================================================
import dotenv from "dotenv";
dotenv.config();

import * as TronWebPkg from "tronweb";
const TronWeb = TronWebPkg.TronWeb || TronWebPkg.default || TronWebPkg;

import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { logger } from "../utils/logger.js";

const NETWORK = (process.env.NETWORK || "mainnet").toLowerCase();
const IS_SHASTA = NETWORK === "shasta";

export const tronWeb = new TronWeb({
  fullHost: IS_SHASTA ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io",
  headers: process.env.TRONGRID_API_KEY
    ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
    : undefined,
});

logger.info(`🌐 Tron network initialized → ${IS_SHASTA ? "Shasta Testnet" : "Mainnet"}`);

// =============================================================
// 🧠 MASTER WALLET INITIALIZATION
// =============================================================
let MASTER_MNEMONIC = null;
let MASTER_SEED = null;
let MASTER_ROOT = null;
let masterInitialized = false;

export async function initMasterWallet({ generateIfMissing = false } = {}) {
  if (masterInitialized) return;

  const rawMnemonic = (process.env.MASTER_MNEMONIC || "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!rawMnemonic) {
    if (generateIfMissing)
      throw new Error("MASTER_MNEMONIC missing — please generate one and add to .env");
    else throw new Error("❌ MASTER_MNEMONIC not found in environment.");
  }

  if (!validateMnemonic(rawMnemonic, wordlist))
    throw new Error("❌ Invalid MASTER_MNEMONIC — checksum failed.");

  MASTER_MNEMONIC = rawMnemonic;
  MASTER_SEED = mnemonicToSeedSync(MASTER_MNEMONIC);
  MASTER_ROOT = HDKey.fromMasterSeed(MASTER_SEED);
  masterInitialized = true;

  logger.info("✅ Master wallet initialized successfully.");
  return true;
}

// =============================================================
// 💎 ADDRESS DERIVATION — Correct BIP-44 Traversal
// =============================================================
export function deriveDepositAddress(index) {
  if (!masterInitialized)
    throw new Error("Master wallet not initialized — call initMasterWallet() first.");
  if (!Number.isInteger(index) || index < 0)
    throw new Error(`❌ Invalid derivation index: ${index}`);

  // 🚀 Always start from a clean copy of the root
  const root = HDKey.fromMasterSeed(MASTER_SEED);

  // Walk BIP-44 path: m / 44' / 195' / 0' / 0 / index
  const node = root
  .deriveChild(44 + 0x80000000)   // 44'
  .deriveChild(195 + 0x80000000)  // 195'
  .deriveChild(0 + 0x80000000)    // 0'
  .deriveChild(0)                 // external chain
  .deriveChild(index);            // address index

  if (!node.privateKey)
    throw new Error(`❌ No private key derived at index ${index}`);

  const privHex = Buffer.from(node.privateKey).toString("hex");
  // Convert private key → public key → TRON address
const account = tronWeb.address.fromPrivateKey(privHex);
const address = account; // direct TRON base58 address


  const path = `m/44'/195'/0'/0/${index}`;
  logger.debug(`🧩 Derived TRON address ${address} (path: ${path})`);
  return { index, address, path };
}


// =============================================================
// 🔐 PRIVATE KEY DERIVATION (for signing)
// =============================================================
export function getPrivateKeyForIndex(index) {
  if (!masterInitialized)
    throw new Error("Master wallet not initialized — call initMasterWallet() first.");
  const node = MASTER_ROOT
    .deriveChild(44 + 0x80000000)
    .deriveChild(195 + 0x80000000)
    .deriveChild(0 + 0x80000000)
    .deriveChild(0)
    .deriveChild(index);

  if (!node.privateKey)
    throw new Error(`❌ No private key at index ${index}`);
  return Buffer.from(node.privateKey).toString("hex");
}

// =============================================================
// 📦 EXPORTS
// =============================================================
export default {
  tronWeb,
  initMasterWallet,
  deriveDepositAddress,
  getPrivateKeyForIndex,
};
