import crypto from "crypto";

// Deterministic SHA256 hash of pool snapshot
export function createPoolHash(poolInfo) {
  const sorted = JSON.stringify(poolInfo, Object.keys(poolInfo).sort());
  return crypto.createHash("sha256").update(sorted).digest("hex");
}
