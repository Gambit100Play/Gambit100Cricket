import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export function getPrivateKey(index) {
  const seed = mnemonicToSeedSync(process.env.MASTER_MNEMONIC, wordlist);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(`m/44'/195'/${index}'/0/0`);
  return Buffer.from(child.privateKey).toString("hex");
}
