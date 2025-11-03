import * as TronWebModule from "tronweb";
const { TronWeb } = TronWebModule;

/**
 * ✅ Publish hash as memo transaction on TRON Shasta testnet
 */
export async function publishHashToTron(hash) {
  try {
    const fullNode = process.env.TRON_FULL_NODE;
    const privateKey = process.env.TRON_PRIVATE_KEY;
    const sender = process.env.TRON_SENDER;
    const receiver = process.env.TRON_RECEIVER;
    const apiKey = process.env.TRONGRID_API_KEY;

    const tronWeb = new TronWeb({
      fullHost: fullNode,
      headers: { "TRON-PRO-API-KEY": apiKey },
      privateKey,
    });

    // 🔍 Debug
    const balanceSun = await tronWeb.trx.getBalance(sender);
    console.log("🔧 [TRON DEBUG: ENV & STATE]", {
      node: fullNode,
      sender,
      receiver,
      apiKeyPresent: !!apiKey,
      hash,
      balanceSUN: balanceSun,
      balanceTRX: balanceSun / 1e6,
    });

    // 🏗️ Step 1: Create TX (1 SUN = minimum)
    console.log(`🚀 [TRON] Building TX from ${sender} → ${receiver}`);
    const baseTx = await tronWeb.transactionBuilder.sendTrx(receiver, 1, sender);

    // 🧾 Step 2: Attach Memo safely (no hex conversion)
    const txWithMemo = await tronWeb.transactionBuilder.addUpdateData(
      baseTx,
      hash, // plain text memo
      "utf8"
    );

    // ✍️ Step 3: Sign TX
    console.log("✍️ [SIGNING TX - Shasta Mode] ...");
    const signedTx = await tronWeb.trx.sign(txWithMemo, privateKey);
    if (!signedTx) throw new Error("Transaction signing failed");

    // ✅ Step 4: Extract txID
    const txHash = signedTx.txID || signedTx.transaction?.txID || null;

    // 🚀 Step 5: Broadcast
    console.log("🚀 [BROADCASTING TX]");
    const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);

    if (broadcast.result) {
      console.log(`🔗 Published to TRON! ✅ TX ID: ${txHash}`);
    } else {
      console.error("🚨 Broadcast failed:", broadcast);
    }

    return txHash || "UNKNOWN_TXID";
  } catch (err) {
    console.error("🚨 TRON publish failed:", err.message);
    return null;
  }
}
