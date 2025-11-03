// src/tests/generateMasterWallet.js
import { createRequire } from "module";
import { mnemonicToSeedSync, generateMnemonic } from "@scure/bip39";

import pkg from "tronweb";
const { TronWeb } = pkg;

const require = createRequire(import.meta.url);
const bip32 = require("bip32");
const ecc = require("tiny-secp256k1");

// Ensure bip32 factory creation works for all versions
const { BIP32Factory } = bip32;
const BIP32 = BIP32Factory ? BIP32Factory(ecc) : bip32;

// 1️⃣ Generate mnemonic
const mnemonic = bip39.generateMnemonic();
console.log("Your master mnemonic (store safely!):", mnemonic);

// 2️⃣ Derive seed + root key
const seed = await bip39.mnemonicToSeed(mnemonic);
const root = BIP32.fromSeed(Buffer.from(seed));

// 3️⃣ Derive TRON path m/44'/195'/0'/0/0
const child = root.derivePath("m/44'/195'/0'/0/0");

// 4️⃣ Clean hex private key
let privateKey = child.privateKey;
if (!Buffer.isBuffer(privateKey)) privateKey = Buffer.from(privateKey);
const privateKeyHex = privateKey.toString("hex");

// 5️⃣ Derive TRON address
const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io" });
const address = TronWeb.address.fromPrivateKey(privateKeyHex);

// ✅ Print result
console.log("First address:", address);
