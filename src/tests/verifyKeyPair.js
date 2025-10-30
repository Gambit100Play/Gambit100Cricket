// src/tests/verifyKeyPair.js
import dotenv from "dotenv";
dotenv.config(); // ✅ load .env before anything else

import TronWebModule from "tronweb";
const TronWeb = TronWebModule.default || TronWebModule;

const tronWeb = new TronWeb({ fullHost: "https://api.shasta.trongrid.io" });

const priv = process.env.TRON_PRIVATE_KEY?.trim();
if (!priv) throw new Error("No TRON_PRIVATE_KEY in .env");

const derived = tronWeb.address.fromPrivateKey(priv);
console.log("🔑 Derived address from private key:", derived);
console.log("📄 TRON_SENDER in .env:", process.env.TRON_SENDER);
console.log(derived === process.env.TRON_SENDER ? "✅ Match!" : "❌ Mismatch!");
