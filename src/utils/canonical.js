// src/utils/canonical.js
import crypto from "crypto";

/** Stable stringify: sort keys depth-first, sort arrays if passed sorter */
export function canonicalStringify(obj) {
  const seen = new WeakSet();

  const sorter = (a, b) => {
    // for arrays of objects with 'id' or 'created_at', sort by those
    if (a && b && typeof a === "object" && typeof b === "object") {
      if ("created_at" in a && "created_at" in b) {
        return String(a.created_at).localeCompare(String(b.created_at));
      }
      if ("id" in a && "id" in b) return String(a.id).localeCompare(String(b.id));
    }
    return JSON.stringify(a).localeCompare(JSON.stringify(b));
  };

  const normalize = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) throw new Error("Cyclic structure in snapshot");
    seen.add(value);

    if (Array.isArray(value)) {
      const copy = value.map(normalize);
      // sort arrays of scalars or homogeneous objects for determinism
      try { copy.sort(sorter); } catch {}
      return copy;
    }
    // object: sort keys
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalize(value[key]);
    }
    return out;
  };

  const normalized = normalize(obj);
  return JSON.stringify(normalized);
}

export function sha256Hex(inputStr) {
  return crypto.createHash("sha256").update(inputStr).digest("hex");
}
