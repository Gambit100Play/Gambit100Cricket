// send-trx.js
import dotenv from "dotenv";
dotenv.config();

import * as TronWebPkg from "tronweb";
const TronWeb = TronWebPkg.TronWeb || TronWebPkg.default || TronWebPkg;

const NETWORK = (process.env.NETWORK || "mainnet").toLowerCase();
const fullHost = NETWORK === "shasta"
  ? "https://api.shasta.trongrid.io"
  : "https://api.trongrid.io";

const tronWeb = new TronWeb({
  fullHost,
  headers: process.env.TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY } : undefined,
  privateKey: process.env.TRON_PRIVATE_KEY // sender private key from .env
});

function toSun(trxAmount) {
  // 1 TRX = 1e6 SUN
  return Math.round(Number(trxAmount) * 1_000_000);
}

async function sendTrx({ toAddress, trxAmount }) {
  if (!tronWeb) throw new Error("tronWeb not initialized");
  if (!toAddress) throw new Error("toAddress required");
  if (!trxAmount || isNaN(Number(trxAmount))) throw new Error("trxAmount required (number)");

  const senderAddress = tronWeb.address.fromPrivateKey(process.env.TRON_PRIVATE_KEY);
  console.log("Sender address:", senderAddress);
  console.log("Recipient address:", toAddress);
  const balanceSun = await tronWeb.trx.getBalance(senderAddress);
  console.log("Sender balance:", (balanceSun / 1e6).toFixed(6), "TRX");

  const amountSun = toSun(trxAmount);
  if (balanceSun < amountSun + 1000) { // small buffer for fees
    throw new Error(`Insufficient balance. Trying to send ${trxAmount} TRX but balance is ${(balanceSun/1e6)} TRX`);
  }

  console.log(`Creating transaction to send ${trxAmount} TRX (${amountSun} SUN)...`);
  // Create + sign + broadcast in one call (tronWeb will use the configured privateKey to sign)
  const result = await tronWeb.trx.sendTransaction(toAddress, amountSun);
  // result structure: { result: true/false, txid: '...' } or an error object
  console.log("Send result:", result);

  if (!result || !result.result) {
    throw new Error("Send failed: " + JSON.stringify(result));
  }

  const txid = result.txid || result;
  console.log("Transaction broadcasted. txid:", txid);
  console.log("You can check it on Shasta Tronscan:", `https://shasta.tronscan.org/#/transaction/${txid}`);
  return txid;
}

// usage from command line
if (process.argv[2] === "--run") {
  const to = process.argv[3];
  const amount = process.argv[4];
  if (!to || !amount) {
    console.error("Usage: node send-trx.js --run <TO_ADDRESS> <AMOUNT_TRX>");
    process.exit(1);
  }
  sendTrx({ toAddress: to, trxAmount: amount })
    .then(txid => console.log("Done:", txid))
    .catch(err => {
      console.error("Error:", err.message || err);
      process.exit(1);
    });
}

export { sendTrx };
