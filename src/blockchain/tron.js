// src/blockchain/tron.js
import TronWeb from "tronweb";
import dotenv from "dotenv";
dotenv.config();

export const tronWeb = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io",
  headers: { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY },
});
