import pkg from "tronweb";
const { TronWeb } = pkg;

// You don't need any API key for local wallet generation.
const tronWeb = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io"
});

(async () => {
  try {
    // Generate a brand new wallet
    const newAccount = await tronWeb.createAccount();

    console.log("✅ New TRON Wallet Generated!");
    console.log("---------------------------------");
    console.log("📫 Address:", newAccount.address.base58);
    console.log("🔐 Private Key:", newAccount.privateKey);
    console.log("🔑 Hex Address:", newAccount.address.hex);
    console.log("---------------------------------");
    console.log("⚠️ Save your PRIVATE KEY securely. Anyone with it can control your wallet.");
  } catch (err) {
    console.error("❌ Error generating wallet:", err.message);
  }
})();
