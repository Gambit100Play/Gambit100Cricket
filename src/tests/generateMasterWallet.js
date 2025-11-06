// =============================================================
// 🪙 Generate Master Wallet + Sample User Deposit Addresses
// =============================================================
import TronWebImport from "tronweb";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import crypto from "crypto";

// 🧩 Detect export style automatically (ESM vs CommonJS)
const TronWeb = TronWebImport?.default?.TronWeb
  || TronWebImport?.TronWeb
  || TronWebImport?.default
  || TronWebImport;

// 🧠 Detect if it’s a class or a static object
let tronWeb;
try {
  tronWeb = new TronWeb({
    fullHost: "https://api.shasta.trongrid.io",
  });
} catch {
  tronWeb = TronWeb; // fallback for static builds
}

console.log("===============================================");
console.log("🚀 Generating New Master TRON Wallet...");
console.log("===============================================");

// 1️⃣ Generate a new mnemonic (BIP39)
const mnemonic = generateMnemonic(wordlist);
console.log("\n🔑 MASTER MNEMONIC (store securely!):\n", mnemonic);

// 2️⃣ Derive seed + root
const seed = mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seed);

// 3️⃣ Derive the master path for TRON (BIP44, coin type 195)
const masterPath = "m/44'/195'/0'/0/0";
const masterNode = root.derive(masterPath);

// 4️⃣ Get the master private key and address
const masterPriv = Buffer.from(masterNode.privateKey).toString("hex");

// If tronWeb is a static object (non-instantiable), use static call:
const masterAddress =
  typeof tronWeb?.address?.fromPrivateKey === "function"
    ? tronWeb.address.fromPrivateKey(masterPriv)
    : TronWeb.address.fromPrivateKey(masterPriv);

console.log("\n🏦 MASTER WALLET DETAILS:");
console.log("→ Derivation Path:", masterPath);
console.log("→ Master Address:", masterAddress);
console.log("→ Master Private Key:", masterPriv);

// 5️⃣ Optional: Generate AES-256 encryption key for your .env vault
const aesKey = crypto.randomBytes(32);
const aesKeyBase64 = aesKey.toString("base64");
console.log("\n🧬 MASTER_ENCRYPTION_KEY (store in .env):", aesKeyBase64);

// 6️⃣ Example: derive first 3 deterministic user deposit addresses
console.log("\n📦 SAMPLE USER DEPOSIT ADDRESSES:");
for (let i = 0; i < 3; i++) {
  const userPath = `m/44'/195'/0'/0/${i}`;
  const userNode = root.derive(userPath);
  const userPriv = Buffer.from(userNode.privateKey).toString("hex");
  const userAddress =
    typeof tronWeb?.address?.fromPrivateKey === "function"
      ? tronWeb.address.fromPrivateKey(userPriv)
      : TronWeb.address.fromPrivateKey(userPriv);

  console.log(`\nUser #${i}`);
  console.log(`Path: ${userPath}`);
  console.log(`Address: ${userAddress}`);
  console.log(`Private Key: ${userPriv}`);
}

console.log("\n✅ Done! Save your MASTER_MNEMONIC & AES KEY in .env securely.");
