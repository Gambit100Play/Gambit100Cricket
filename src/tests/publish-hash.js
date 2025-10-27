import pkg from "tronweb";
const { TronWeb }=pkg;
// import TronWeb from "tronweb";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

// 🧩 Configure TronWeb with your keys
const tronWeb = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io",
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
  privateKey: process.env.TRON_PRIVATE_KEY,
});

// 🧩 Generate example pool data and hash
const poolData = {
  matchId: "INDvAUS-2025-10-23",
  lockedAt: new Date().toISOString(),
  totalStakes: 2500,
  outcomes: { "India to Win": 10, "Australia to Win": 12 },
};

const poolHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(poolData))
  .digest("hex");

console.log("🔐 Pool Hash:", poolHash);

(async () => {
  try {
    const fromAddr = tronWeb.address.fromPrivateKey(process.env.TRON_PRIVATE_KEY);
    const toAddr = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"; // TRON blackhole
    const amountSun = tronWeb.toSun(1); // send 1 TRX as a marker tx

    console.log("📬 Using wallet:", fromAddr);

    // ✅ Step 1: Build transaction (no mutation yet)
    const tx = await tronWeb.transactionBuilder.sendTrx(toAddr, amountSun, fromAddr);

    // ✅ Step 2: Safely encode memo via builder
    // TronWeb internally enforces structure, so use the following pattern:
    const hexMemo = tronWeb.toHex(poolHash.slice(0, 120)); // limit memo length
    tx.raw_data.contract[0].parameter.value.data = hexMemo; // attach data properly

    // ✅ Step 3: Sign the transaction
    const signedTx = await tronWeb.trx.sign(tx, process.env.TRON_PRIVATE_KEY);

    // ✅ Step 4: Broadcast to network
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (result?.result) {
      console.log("✅ Successfully published hash to TRON!");
      console.log("🔗 TxID:", result.txid);
      console.log(`🌐 View: https://shasta.tronscan.org/#/transaction/${result.txid}`);
    } else {
      console.error("❌ Broadcast failed:", result);
    }
  } catch (err) {
    console.error("💥 Publish error:", err);
  }
})();
