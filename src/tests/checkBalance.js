// src/tests/checkBalance.js
import dotenv from "dotenv";
dotenv.config();

import TronWebModule from "tronweb";
const TronWeb = TronWebModule.default || TronWebModule;

const tronWeb = new TronWeb({
  fullHost: process.env.TRON_FULL_NODE?.trim() || "https://api.shasta.trongrid.io",
  privateKey: process.env.TRON_PRIVATE_KEY?.trim(),
});

async function checkBalance() {
  try {
    const address = process.env.TRON_SENDER?.trim();
    if (!address) throw new Error("Missing TRON_SENDER in .env");

    const balanceSun = await tronWeb.trx.getBalance(address);
    const balanceTRX = balanceSun / 1_000_000;

    console.log(`💰 Address: ${address}`);
    console.log(`💵 Balance: ${balanceTRX} TRX`);
  } catch (err) {
    console.error("🚨 Balance check failed:", err.message);
  }
}

checkBalance();
