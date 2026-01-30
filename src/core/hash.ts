/**
 * Hashing utilities for Tix
 * 
 * Implements:
 * - SHA256 hashing
 * - Nix32 encoding (Nix's custom base32)
 * - Deterministic JSON serialization
 * - Store path computation
 */

import { createHash } from "node:crypto";
import type { Hash, Nix32Hash, StorePath, DrvPath } from "./types";

// =============================================================================
// Nix32 Encoding
// =============================================================================

/**
 * Nix's custom base32 alphabet (omits e, o, u, t to avoid confusion)
 */
const NIX32_ALPHABET = "0123456789abcdfghijklmnpqrsvwxyz";

/**
 * Encode bytes to Nix32 format.
 * 
 * Nix's base32 is unusual:
 * 1. Uses alphabet without e, o, u, t (to avoid confusion)
 * 2. Bytes are reversed before encoding
 * 3. Bits are extracted LSB-first
 */
export function nix32Encode(bytes: Buffer): Nix32Hash {
  if (bytes.length === 0) return "" as Nix32Hash;
  
  // Reverse the bytes (Nix does this!)
  const reversed = Buffer.from(bytes).reverse();
  
  const len = Math.ceil((reversed.length * 8) / 5);
  const chars: string[] = new Array(len);
  
  for (let n = 0; n < len; n++) {
    const b = n * 5;
    const i = Math.floor(b / 8);
    const j = b % 8;
    
    // Extract 5 bits, handling byte boundary
    let c = (reversed[i] >> j) & 0x1f;
    if (i + 1 < reversed.length && j > 3) {
      c |= (reversed[i + 1] << (8 - j)) & 0x1f;
    }
    
    // Output in reverse order
    chars[len - 1 - n] = NIX32_ALPHABET[c];
  }
  
  return chars.join("") as Nix32Hash;
}

// =============================================================================
// SHA256 Hashing
// =============================================================================

export function sha256(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

export function sha256Hex(data: string | Buffer): Hash {
  return sha256(data).toString("hex") as Hash;
}

/**
 * Hash and truncate to 160 bits (20 bytes), then Nix32 encode.
 * This is how Nix computes store path digests.
 */
export function sha256Truncated(data: string | Buffer): Nix32Hash {
  const fullHash = sha256(data);
  const truncated = fullHash.subarray(0, 20);
  return nix32Encode(truncated);
}

// =============================================================================
// Deterministic JSON
// =============================================================================

/**
 * Deterministic JSON serialization with sorted keys.
 * Critical for reproducible hashing.
 */
export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
    }
    return value;
  });
}

// =============================================================================
// Store Path Computation
// =============================================================================

/**
 * Compute a store path from a fingerprint.
 * 
 * Formula: storeDir + "/" + nix32(sha256(fingerprint)[0:20]) + "-" + name
 * 
 * @param type - The type prefix (e.g., "output:out", "source")
 * @param innerDigest - The hex-encoded SHA256 of the inner fingerprint
 * @param storeDir - The store directory (e.g., "/tix/store")
 * @param name - The derivation/file name
 */
export function computeStorePath(
  type: string,
  innerDigest: Hash,
  storeDir: string,
  name: string
): StorePath {
  // fingerprint = type ":sha256:" innerDigest ":" storeDir ":" name
  const fingerprint = `${type}:sha256:${innerDigest}:${storeDir}:${name}`;
  const digest = sha256Truncated(fingerprint);
  return `${storeDir}/${digest}-${name}` as StorePath;
}

/**
 * Compute output path for a derivation.
 */
export function computeOutputPath(
  drvHashHex: Hash,
  storeDir: string,
  name: string
): StorePath {
  return computeStorePath("output:out", drvHashHex, storeDir, name);
}

/**
 * Compute path for a source file.
 */
export function computeSourcePath(
  contentHash: Hash,
  storeDir: string,
  name: string
): StorePath {
  return computeStorePath("source", contentHash, storeDir, name);
}

/**
 * Compute path for a fixed-output derivation.
 * These are identified by their OUTPUT hash, not their inputs.
 */
export function computeFixedOutputPath(
  contentHash: Hash,
  hashMode: "flat" | "recursive",
  storeDir: string,
  name: string
): StorePath {
  // Inner fingerprint for fixed-output: "fixed:out:" + mode + "sha256:" + hash + ":"
  const modePrefix = hashMode === "recursive" ? "r:" : "";
  const innerFingerprint = `fixed:out:${modePrefix}sha256:${contentHash}:`;
  const innerDigest = sha256Hex(innerFingerprint);
  return computeStorePath("output:out", innerDigest, storeDir, name);
}
