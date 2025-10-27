// src/utils/wallet.js
import dotenv from "dotenv";
dotenv.config();

import * as TronWebNS from "tronweb";
import { createRequire } from "module";
import bip39 from "bip39";

// ESM-safe imports for BIP32 + secp256k1
const require = createRequire(import.meta.url);
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const BIP32 = BIP32Factory(ecc);

// ────────────────────────────────────────────────
// 🔌 TronWeb compat import (works with v5 CJS & v6 ESM)
// ────────────────────────────────────────────────
const TronWeb = TronWebNS.TronWeb ?? TronWebNS.default ?? TronWebNS;
if (typeof TronWeb !== "function") {
  console.error("[tronweb] export keys:", Object.keys(TronWebNS || {}));
  throw new Error(
    "tronweb import did not expose a constructor. " +
    "Run `npm ls tronweb` and ensure only one version is installed."
  );
}

// ────────────────────────────────────────────────
// ⚙️ Configuration
// ────────────────────────────────────────────────
const MASTER_MNEMONIC = (process.env.MASTER_MNEMONIC || "").trim();
if (!MASTER_MNEMONIC) {
  console.error("❌ MASTER_MNEMONIC missing in .env file!");
  throw new Error("MASTER_MNEMONIC is required");
}

const NETWORK = (process.env.NETWORK || "mainnet").toLowerCase();
const IS_SHASTA = NETWORK === "shasta";

export const tronWeb = new TronWeb({
  fullHost: IS_SHASTA ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io",
  headers: process.env.TRONGRID_API_KEY
    ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY }
    : undefined,
  // privateKey not needed for read-only utils
});

// ────────────────────────────────────────────────
// 🧩 Derive TRON Address from HD Wallet
//   Path: m/44'/195'/0'/0/{index}
// ────────────────────────────────────────────────
export async function deriveAddressForIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid derivation index: ${index}`);
  }

  const seed = await bip39.mnemonicToSeed(MASTER_MNEMONIC);
  const root = BIP32.fromSeed(seed);

  const path = `m/44'/195'/0'/0/${index}`;
  const child = root.derivePath(path);
  if (!child.privateKey) {
    throw new Error(`❌ No private key derived for index ${index}`);
  }

  const privateKeyHex = Buffer.from(child.privateKey).toString("hex");

  // Try instance method first, then static fallback (covers v5/v6 differences)
  const fromPriv =
    (tronWeb.address && tronWeb.address.fromPrivateKey) ||
    (TronWeb.address && TronWeb.address.fromPrivateKey);

  if (typeof fromPriv !== "function") {
    throw new Error("TronWeb.address.fromPrivateKey is unavailable");
  }

  const address = fromPriv(privateKeyHex);
  if (!address || typeof address !== "string" || !address.startsWith("T")) {
    throw new Error("Invalid TRON address derivation");
  }

  // ⚠️ SECURITY: avoid returning private keys from utils unless absolutely necessary.
  return { index, address /*, privateKey: privateKeyHex */ };
}

// ────────────────────────────────────────────────
// 👤 Deterministic Deposit Address per Telegram User
//   Returns a STRING address for easy use by handlers
// ────────────────────────────────────────────────
export async function getAddressForUser(telegramId) {
  // Derive a safe bounded index (0–999999)
  const numericIndex = Number(String(telegramId).replace(/\D/g, "")) % 1_000_000;
  const { address } = await deriveAddressForIndex(numericIndex);
  return address; // ← handlers expect a plain string
}
