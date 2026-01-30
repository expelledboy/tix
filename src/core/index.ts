/**
 * Tix - A tiny, TypeScript reimagining of Nix
 * 
 * Core exports
 */

// Types
export type {
  StorePath,
  DrvPath,
  Hash,
  Nix32Hash,
  System,
  Source,
  Derivation,
  DrvFile,
  StoreConfig,
} from "./types";

export { currentSystem, DEFAULT_STORE_DIR, validateDerivation, validateDerivationName } from "./types";

// Hashing
export {
  sha256,
  sha256Hex,
  sha256Truncated,
  nix32Encode,
  stableStringify,
  computeStorePath,
  computeOutputPath,
  computeSourcePath,
  computeFixedOutputPath,
} from "./hash";

// Store
export { Store } from "./store";

// Derivations
export {
  hashDerivationModulo,
  instantiate,
  topoSort,
  getAllDeps,
} from "./derivation";

// Building
export type { BuildConfig } from "./build";
export { realize } from "./build";
