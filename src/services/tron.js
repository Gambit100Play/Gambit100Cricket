// ───────────────────────────────────────────────
// 🔧 Safe import that works for both ESM & CJS
// ───────────────────────────────────────────────
import TronWebModule from "tronweb";
const TronWeb = TronWebModule.default || TronWebModule;

/**
 * ✅ Required environment variables:
 *  - TRON_FULL_NODE (https://api.trongrid.io or https://api.shasta.trongrid.io)
 *  - TRON_PRIVATE_KEY
 *  - TRON_SENDER (base58)
 *  - Optional: TRON_RECEIVER (base58)
 */

function checkEnv() {
  const required = ["TRON_FULL_NODE", "TRON_PRIVATE_KEY", "TRON_SENDER"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`🚨 Missing Tron env vars: ${missing.join(", ")}`);

  for (const k of ["TRON_FULL_NODE", "TRON_PRIVATE_KEY", "TRON_SENDER", "TRON_RECEIVER"]) {
    if (process.env[k])
      process.env[k] = process.env[k]
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/\uFEFF/g, "")
        .replace(/\r|\n/g, "");
  }

  console.log("🔧 ENV CHECK:", {
    TRON_FULL_NODE: process.env.TRON_FULL_NODE,
    TRON_SENDER: process.env.TRON_SENDER,
    TRON_PRIVATE_KEY: `✅ loaded (${process.env.TRON_PRIVATE_KEY.slice(0, 6)}…)`,
  });
}

// ───────────────────────────────────────────────
// 🧩 TronWeb instance builder
// ───────────────────────────────────────────────
function tron() {
  checkEnv();
  return new TronWeb({
    fullHost: process.env.TRON_FULL_NODE,
    privateKey: process.env.TRON_PRIVATE_KEY,
  });
}

/**
 * 🔒 Publish a hash as a memo (1 Sun self-transfer)
 */
export async function publishHashMemo(hashHex, label = "PoolLock") {
  const tw = tron();

  const from = process.env.TRON_SENDER;
  const to =
    process.env.TRON_RECEIVER && process.env.TRON_RECEIVER !== from
      ? process.env.TRON_RECEIVER
      : from;

  const memo = `${label}:${hashHex}`.slice(0, 190).replace(/[^\x20-\x7E]/g, "?");
  const memoBase64 = Buffer.from(memo, "utf8").toString("base64");

  try {
    const balance = await tw.trx.getBalance(from);
    console.log(`💰 [Balance] Wallet ${from} = ${balance} Sun`);
    if (balance < 100000) throw new Error("Insufficient TRX (need ≥ 0.1 TRX)");

    // ✅ Build transaction through official builder
    const tx = await tw.transactionBuilder.sendTrx(to, 1, from);
    tx.raw_data.data = memoBase64;
    tx.raw_data.fee_limit = 10_000_000;

    // ✅ Sign & broadcast
    const signed = await tw.trx.sign(tx);
    console.log("🖋️ [TronTx] Transaction signed successfully");

    const receipt = await tw.trx.sendRawTransaction(signed);
    if (!receipt.result)
      throw new Error(`Broadcast failed: ${JSON.stringify(receipt)}`);

    const txid = receipt.txid || signed.txID;
    const explorer =
      process.env.TRON_FULL_NODE.includes("shasta") ||
      process.env.NETWORK === "shasta"
        ? `https://shasta.tronscan.org/#/transaction/${txid}`
        : `https://tronscan.org/#/transaction/${txid}`;

    console.log("✅ [TronTx] Hash published successfully!");
    console.log(`   🧩 Memo: ${memo}`);
    console.log(`   🔗 Explorer: ${explorer}`);
    return { txid, memo, explorer };
  } catch (err) {
    console.error(`❌ [TronTx] Error: ${err.message}`);
    throw new Error(`Failed to publish Tron memo: ${err.message}`);
  }
}
