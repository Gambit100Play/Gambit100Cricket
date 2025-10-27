import pkg from "tronweb";
const { TronWeb } =pkg;
import dotenv from "dotenv";
dotenv.config();

const tronWeb = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io",
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
});

(async () => {
  const block = await tronWeb.trx.getCurrentBlock();
  console.log("✅ Connected to Shasta! Block:", block.block_header.raw_data.number);
})();
