import pkg from "tronweb";
const { TronWeb }=pkg;

const privateKey = "CF2F00385E4680CB46B1D43498FE2A7B1593B1FD1B15B8C9002A4F1C53DDA58D";
const tw = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io",
  privateKey
});

const derivedAddress = tw.address.fromPrivateKey(privateKey);
console.log("Derived Address:", derivedAddress);
