/**
 * Tix - A tiny, TypeScript reimagining of Nix
 */

// Re-export the user-facing API
export {
  // Derivation builders
  sh,
  drv,
  fetchUrl,
  env,
  
  // Build operations
  build,
  outPath,
  show,
  
  // Store access
  getStore,
  Store,
  
  // Lower-level
  instantiate,
  realize,
  topoSort,
} from "./api";

// Re-export types
export type {
  Derivation,
  StorePath,
  DrvPath,
  System,
} from "./core";
