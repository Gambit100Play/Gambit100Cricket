import express from "express";
import cors from "cors";

import { signSweepTx, sha256Hex } from "./tron.js";
import { kmsSign } from "./kms.js";

const app = express();
app.use(express.json());
app.use(cors());


// --------------------------------
// Health check
// --------------------------------
app.get("/", (req, res) => {
  res.json({ status: "signer active" });
});


// --------------------------------
// Sweep endpoint
// --------------------------------
app.post("/sweep", async (req, res) => {
  try {
    const { unsignedTx, index } = req.body;
    const signedTx = await signSweepTx(unsignedTx, index);

    res.json({ success: true, signedTx });
  } catch (err) {
    console.error("Sweep Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// --------------------------------
// Withdrawal endpoint
// --------------------------------
app.post("/withdraw", async (req, res) => {
  try {
    const { unsignedTxHex } = req.body;

    const digest = sha256Hex(unsignedTxHex);
    const derSignature = await kmsSign(digest);

    res.json({
      success: true,
      derSignature: derSignature.toString("hex")
    });

  } catch (err) {
    console.error("Withdrawal Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// --------------------------------
app.listen(process.env.PORT, () => {
  console.log(`SIGNER running on port ${process.env.PORT}`);
});
