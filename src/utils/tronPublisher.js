// src/utils/tronPublisher.js
// ✅ Correct import for tronweb@6.x (Node 20+ ESM)
import * as TronWebModule from "tronweb";
import https from "https"; // 🔥 used for manual broadcast
const { TronWeb } = TronWebModule;

/**
 * 🧾 Publish a hash memo transaction on TRON (with full debug logging)
 */
export async function publishHashToTron(hash) {
  try {
    if (!hash) throw new Error("No hash provided");

    // ────────────── ENV CLEANUP ──────────────
    const sender = process.env.TRON_SENDER?.trim();
    const receiver = process.env.TRON_RECEIVER?.trim();
    const pk = process.env.TRON_PRIVATE_KEY?.trim();
    const fullNode =
      process.env.TRON_FULL_NODE?.trim() || "https://api.shasta.trongrid.io";
    const apiKey = process.env.TRONGRID_API_KEY?.trim();

    if (!sender || !receiver || !pk)
      throw new Error("Missing TRON_SENDER, TRON_RECEIVER, or TRON_PRIVATE_KEY");

    // ────────────── INIT TRONWEB ──────────────
    const tronWeb = new TronWeb({
      fullHost: fullNode,
      headers: { "TRON-PRO-API-KEY": apiKey },
      privateKey: pk,
    });

    // ────────────── DERIVED ADDRESS & BALANCE CHECK ──────────────
    const derived = tronWeb.address.fromPrivateKey(pk);
    const balance = await tronWeb.trx.getBalance(sender);

    console.log("🔧 [TRON DEBUG: ENV & STATE]", {
      node: fullNode,
      sender,
      derived,
      receiver,
      apiKeyPresent: Boolean(apiKey),
      hash,
      balanceSUN: balance,
      balanceTRX: balance / 1_000_000,
    });

    if (derived !== sender) {
      throw new Error(
        `❌ Private key does not match TRON_SENDER. Derived=${derived}, Sender=${sender}`
      );
    }

    if (balance <= 0) {
      throw new Error(
        `❌ Sender balance is 0 TRX. Please fund via Shasta faucet before retrying.`
      );
    }

    console.log(`🚀 [TRON] Building TX from ${sender} → ${receiver}`);

    // ────────────── TX CREATION ──────────────
    let tx = await tronWeb.transactionBuilder.sendTrx(
      receiver,
      1_000_000, // 1 TRX
      sender
    );
    tx.visible = true; // ensure base58 serialization

    console.log("📦 [TX RAW CREATED]", tx);

    // ────────────── Attach memo ──────────────
    const memoHex = tronWeb.toHex(hash).replace(/^0x/, "");
    tx.raw_data.data = memoHex;

    console.log("🧾 [TX AFTER MEMO ATTACH]", {
      dataHex: memoHex,
      rawData: tx.raw_data,
      visibleFlag: tx.visible,
    });

    // ────────────── SIGN (RAW DER MODE for Shasta) ──────────────
    console.log("✍️ [SIGNING TX - Raw DER Mode for Shasta] ...");

    // Step 1: Compute TX hash
    const txHash = await tronWeb.trx.getTransactionHash(tx);

    // Step 2: Sign raw hex hash using private key (DER-encoded)
    const signedHex = tronWeb.utils.crypto.signHex(txHash, pk);

    // Step 3: Attach signature manually
    tx.signature = [signedHex];
    tx.txID = txHash; // ensure txID field present

    console.log("✍️ [SIGNED TX]", {
      txID: txHash,
      signature: signedHex,
      sigLength: signedHex.length,
    });

    // ────────────── BROADCAST (MANUAL WITH API KEY) ──────────────
    console.log("📤 [TRON] Broadcasting transaction manually with API key...");

    const receipt = await new Promise((resolve, reject) => {
      const data = JSON.stringify(tx);
      const url = new URL(`${fullNode}/wallet/broadcasttransaction`);

      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "TRON-PRO-API-KEY": apiKey,
        },
      };

      const req = https.request(options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => (responseData += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(responseData);
            resolve(json);
          } catch {
            reject(new Error("Failed to parse node response"));
          }
        });
      });

      req.on("error", (err) => reject(err));
      req.write(data);
      req.end();
    });

    console.log("📡 [TRON RECEIPT]", receipt);

    if (!receipt?.result)
      throw new Error(`❌ Broadcast rejected: ${JSON.stringify(receipt)}`);

    const txid = receipt.txid || tx.txID;
    console.log(`✅ [TRON] Broadcasted TX: ${txid}`);

    // ────────────── CONFIRMATION WAIT ──────────────
    for (let i = 0; i < 15; i++) {
      const info = await tronWeb.trx.getTransactionInfo(txid);
      if (info?.receipt?.result === "SUCCESS") {
        console.log("✅ [TRON] Confirmed on-chain (Shasta)");
        return txid;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.warn("⚠️ [TRON] Broadcasted but not yet confirmed");
    return txid;
  } catch (err) {
    console.error("🚨 TRON publish failed:", err.message || err);
    return null;
  }
}
