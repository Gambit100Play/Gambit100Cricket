// src/utils/sendTrc20.js
import dotenv from "dotenv";
dotenv.config();

import { tronWeb } from "../wallet/masterWallet.js";
import { logger } from "../utils/logger.js";

/**
 * Send TRC-20 tokens (e.g., USDT) from master wallet to a recipient address.
 * @param {Object} p
 * @param {string} p.to - recipient address (T...)
 * @param {number|string} p.amount - human units (e.g., 12.34)
 * @param {string} p.contract - TRC-20 contract address (T...)
 * @param {number} [p.decimals=6]
 * @param {string} [p.fromPk=process.env.TRON_PRIVATE_KEY]
 * @returns {Promise<string>} txid
 */
export async function sendTRC20({ to, amount, contract, decimals = 6, fromPk = process.env.TRON_PRIVATE_KEY }) {
  if (!tronWeb.isAddress(to)) throw new Error("Invalid recipient address");
  if (!contract || !tronWeb.isAddress(contract)) throw new Error("Missing/invalid TRC-20 contract address");
  if (!fromPk) throw new Error("Missing TRON_PRIVATE_KEY (master wallet)");

  const sender = tronWeb.address.fromPrivateKey(fromPk);

  // 1) Ensure master has enough TRX for gas
  const balSun = await tronWeb.trx.getBalance(sender);
  const balTRX = balSun / 1e6;
  if (balTRX < 30) {
    throw new Error(`Insufficient TRX for gas: have ${balTRX.toFixed(2)} TRX, need ~30 TRX`);
  }

  // 2) Build transaction
  const amountInt = BigInt(Math.round(Number(amount) * 10 ** decimals));
  const tx = await tronWeb.transactionBuilder.triggerSmartContract(
    tronWeb.address.toHex(contract),
    "transfer(address,uint256)",
    {},
    [
      { type: "address", value: tronWeb.address.toHex(to) },
      { type: "uint256", value: amountInt.toString() },
    ],
    tronWeb.address.toHex(sender)
  );
  if (!tx?.transaction) throw new Error("Failed to build TRC-20 transfer");

  // 3) Sign + broadcast
  const signed = await tronWeb.trx.sign(tx.transaction, fromPk);
  const res = await tronWeb.trx.sendRawTransaction(signed);

  if (!res?.result) {
    const msg = res?.code ? `${res.code}: ${res.message}` : "Broadcast failed";
    throw new Error(msg);
  }

  const txid = res.txid || res.txID;
  logger.info(`💸 [TRC20] Sent ${amount} tokens to ${to} (txid=${txid})`);
  return txid;
}
