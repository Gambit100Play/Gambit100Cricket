import TronWeb from "tronweb";
import * as bip39 from "bip39";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import crypto from "crypto";

import { fetchSeed } from "./kms.js";

const bip32 = BIP32Factory(ecc);

const tronWeb = new TronWeb({
  fullHost: process.env.TRON_RPC
});

function wipe(buf) {
  if (!buf) return;
  if (typeof buf.fill === "function") buf.fill(0);
}


// ---------------------------------------------
// Derive child private key from BIP44 path
// m/44'/195'/0'/0/index
// ---------------------------------------------
export async function deriveChildKey(index) {
  const mnemonic = await fetchSeed();
  const seed = await bip39.mnemonicToSeed(mnemonic);

  const root = bip32.fromSeed(seed);
  const path = `m/44'/195'/0'/0/${index}`;
  const child = root.derivePath(path);

  wipe(seed);

  return child.privateKey;
}


// ---------------------------------------------
// Sweep signing (deposit → master wallet)
// ---------------------------------------------
export async function signSweepTx(unsignedTx, index) {
  const priv = await deriveChildKey(index);
  if (!priv) throw new Error("Key derivation failed");

  try {
    return await tronWeb.trx.sign(unsignedTx, priv.toString("hex"));
  } finally {
    wipe(priv);
  }
}


// ---------------------------------------------
// KMS digest helper (for withdrawals)
// ---------------------------------------------
export function sha256Hex(hex) {
  return crypto.createHash("sha256")
    .update(Buffer.from(hex, "hex"))
    .digest();
}
