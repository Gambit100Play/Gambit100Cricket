import pkg from "tronweb";
const { TronWeb } = pkg;

/**
 * ✅ Required environment variables:
 *  - TRON_FULL_NODE  (e.g. https://api.trongrid.io or https://api.shasta.trongrid.io)
 *  - TRON_PRIVATE_KEY
 *  - TRON_SENDER  (base58)
 *  - Optional: TRON_RECEIVER (base58)
 */

function checkEnv() {
  const missing = [];
  for (const key of ["TRON_FULL_NODE", "TRON_PRIVATE_KEY", "TRON_SENDER"]) {
    if (!process.env[key]) missing.push(key);
  }
  if (missing.length > 0) throw new Error(`🚨 Missing Tron env vars: ${missing.join(", ")}`);

  for (const k of ["TRON_FULL_NODE", "TRON_PRIVATE_KEY", "TRON_SENDER", "TRON_RECEIVER"]) {
    if (process.env[k])
      process.env[k] = process.env[k].trim().replace(/^"|"$/g, "").replace(/\uFEFF/g, "");
  }

  console.log("🔧 ENV CHECK:", {
    TRON_FULL_NODE: process.env.TRON_FULL_NODE,
    TRON_SENDER: process.env.TRON_SENDER,
    TRON_PRIVATE_KEY: `✅ loaded (${process.env.TRON_PRIVATE_KEY.slice(0, 6)}…)`,
  });
}

export function tron() {
  checkEnv();
  const node = process.env.TRON_FULL_NODE;
  return new TronWeb({
    fullNode: node,
    solidityNode: node,
    eventServer: node,
    privateKey: process.env.TRON_PRIVATE_KEY,
  });
}

/**
 * 🔒 Publish a hash as memo (Tx.data)
 * Attaches <label>:<hash> to a 1 Sun transfer
 */
export async function publishHashMemo(hashHex, label = "PoolLock") {
  checkEnv();
  const tw = tron();

  const from = process.env.TRON_SENDER;
  const to =
    process.env.TRON_RECEIVER && process.env.TRON_RECEIVER !== from
      ? process.env.TRON_RECEIVER
      : from; // ✅ self-transfer if no receiver

  console.log(`🔐 Attempting to publish hash: ${hashHex}`);

  // Helper: sign + broadcast
  const signAndBroadcast = async (tx) => {
    const memo = `${label}:${hashHex}`.slice(0, 190).replace(/[^\x20-\x7E]/g, "?");
    tx.raw_data.data = Buffer.from(memo, "utf8").toString("base64");
    if (typeof tx.raw_data.fee_limit !== "number") tx.raw_data.fee_limit = 10_000_000;

    const signed = await tw.trx.sign(tx);
    console.log("🖋️ [TronTx] Transaction signed successfully");

    const receipt = await tw.trx.sendRawTransaction(signed);
    if (!receipt?.result) {
      console.error("❌ [TronTx] Broadcast failed:", receipt);
      throw new Error(`Broadcast failed: ${JSON.stringify(receipt)}`);
    }

    const txid = signed.txID || receipt.txid;
    const explorerBase =
      process.env.TRON_FULL_NODE.includes("shasta") || process.env.NETWORK === "shasta"
        ? "https://shasta.tronscan.org/#/transaction"
        : "https://tronscan.org/#/transaction";
    const explorer = `${explorerBase}/${txid}`;

    console.log("✅ [TronTx] Hash published successfully!");
    console.log(`   🧩 Memo: ${memo}`);
    console.log(`   🔗 Explorer: ${explorer}`);

    return { txid, memo, explorer };
  };

  try {
    // ✅ Balance check
    const balance = await tw.trx.getBalance(from);
    console.log(`💰 [Balance] Wallet ${from} = ${balance} Sun`);
    if (balance < 100000) throw new Error("Insufficient TRX (need ≥ 0.1 TRX)");

    // ✅ Validate addresses
    if (!tw.isAddress(from)) throw new Error(`Invalid sender address: ${from}`);
    if (!tw.isAddress(to)) throw new Error(`Invalid receiver address: ${to}`);

    // ✅ Preferred path: builder
    try {
      const tx = await tw.transactionBuilder.sendTrx(to, 1, from); // 1 Sun
      if (!tx.raw_data.expiration) tx.raw_data.expiration = Date.now() + 10 * 60 * 1000;
      if (!tx.raw_data.timestamp) tx.raw_data.timestamp = Date.now();
      return await signAndBroadcast(tx);
    } catch (builderErr) {
      console.warn("⚠️ Builder path failed, trying manual build:", builderErr.message);
    }

    // ✅ Fallback: manual build
    const latestBlock = await tw.trx.getCurrentBlock();
    const blockNumber = latestBlock.block_header.raw_data.number;
    const blockHash = latestBlock.blockID;

   // --- address conversions (TronWeb auto-detects Base58) ---
const ownerHex = tw.address.toHex(from);
const toHex = tw.address.toHex(to);


    const refBlockBytes = blockNumber.toString(16).slice(-4).padStart(4, "0");
    const refBlockHash = blockHash.substring(16, 24);

    const manualTx = {
      visible: false,
      raw_data: {
        contract: [
          {
            parameter: {
              value: {
                amount: 1,
                owner_address: ownerHex,
                to_address: toHex,
              },
              type_url: "type.googleapis.com/protocol.TransferContract",
            },
            type: "TransferContract",
          },
        ],
        ref_block_bytes: refBlockBytes,
        ref_block_hash: refBlockHash,
        expiration: Date.now() + 10 * 60 * 1000,
        timestamp: Date.now(),
        fee_limit: 10_000_000,
      },
    };

    return await signAndBroadcast(manualTx);
  } catch (err) {
    console.error(`❌ [TronTx] Error: ${err.message}`);
    throw new Error(`Failed to publish Tron memo: ${err.message}`);
  }
}
