/**
 * Derivation handling for Tix
 * 
 * Implements:
 * - hashDerivationModulo: The recursive hash computation
 * - instantiate: Convert Derivation -> DrvFile and write to store
 */

import type { 
  Derivation, DrvFile, StorePath, DrvPath, Hash, System 
} from "./types";
import { currentSystem, DEFAULT_STORE_DIR, validateDerivation } from "./types";
import { sha256Hex, stableStringify, computeOutputPath, computeFixedOutputPath } from "./hash";
import { Store } from "./store";

// =============================================================================
// Derivation Hashing (The Core Algorithm)
// =============================================================================

/**
 * Compute the "derivation modulo" hash.
 * 
 * This is the critical function that makes Nix work. It computes a hash
 * of a derivation where:
 * 
 * 1. Output paths are replaced with empty strings
 * 2. Input derivations are replaced with their hashes (recursive!)
 * 3. Fixed-output derivations are replaced with a hash of their output
 * 
 * This ensures:
 * - Same inputs -> same hash -> same output path
 * - Changing any transitive dependency changes the hash
 * - Fixed-output derivations are identified by their content, not build recipe
 */
export function hashDerivationModulo(
  drv: Derivation,
  storeDir: string,
  cache: Map<Derivation, Hash> = new Map()
): Hash {
  // Check cache first (handles cycles and avoids recomputation)
  const cached = cache.get(drv);
  if (cached) return cached;
  
  // For fixed-output derivations, hash is based on the OUTPUT, not inputs
  if (drv.outputHash) {
    const mode = drv.outputHashMode ?? "flat";
    const innerFingerprint = `fixed:out:${mode === "recursive" ? "r:" : ""}sha256:${drv.outputHash}:`;
    const hash = sha256Hex(innerFingerprint);
    cache.set(drv, hash);
    return hash;
  }
  
  // Compute input hashes recursively
  const inputHashes: Record<string, string[]> = {};
  for (const input of drv.inputs ?? []) {
    const inputHash = hashDerivationModulo(input, storeDir, cache);
    // We use the hash as the key (like Nix replaces drv paths with hashes)
    inputHashes[inputHash] = ["out"];
  }
  
  // Build the representation to hash
  // This must be deterministic - sorted keys, stable serialization
  const toHash = {
    name: drv.name,
    system: drv.system ?? currentSystem(),
    builder: drv.builder,
    args: drv.args ?? [],
    env: drv.env ?? {},
    inputs: inputHashes,
    // Note: outputs are EMPTY for hashing (chicken-egg problem)
    outputs: { out: "" },
    // Include source hash if present
    src: drv.src?.type === "path" ? drv.src.path : drv.src?.hash,
  };
  
  const hash = sha256Hex(stableStringify(toHash));
  cache.set(drv, hash);
  return hash;
}

// =============================================================================
// Instantiation (Derivation -> DrvFile -> Store)
// =============================================================================

/**
 * Instantiate a derivation: compute all paths, write .drv to store.
 * 
 * Returns the derivation path and output path.
 */
export function instantiate(
  store: Store,
  drv: Derivation,
  cache: Map<Derivation, { drvPath: DrvPath; outPath: StorePath }> = new Map()
): { drvPath: DrvPath; outPath: StorePath } {
  // Validate the derivation
  validateDerivation(drv);
  
  // Check cache
  const cached = cache.get(drv);
  if (cached) return cached;
  
  const storeDir = store.dir;
  const system = drv.system ?? currentSystem();
  
  // First, instantiate all inputs (recursive, depth-first)
  const inputResults = new Map<Derivation, { drvPath: DrvPath; outPath: StorePath }>();
  for (const input of drv.inputs ?? []) {
    const result = instantiate(store, input, cache);
    inputResults.set(input, result);
  }
  
  // Compute the derivation hash
  const drvHash = hashDerivationModulo(drv, storeDir, new Map());
  
  // Compute output path
  let outPath: StorePath;
  if (drv.outputHash) {
    // Fixed-output: path determined by content hash
    outPath = computeFixedOutputPath(
      drv.outputHash,
      drv.outputHashMode ?? "flat",
      storeDir,
      drv.name
    );
  } else {
    // Input-addressed: path determined by derivation hash
    outPath = computeOutputPath(drvHash, storeDir, drv.name);
  }
  
  // Compute derivation path (always input-addressed)
  const drvPath = `${computeOutputPath(drvHash, storeDir, drv.name)}.drv` as DrvPath;
  
  // Add source to store if present
  let inputSrcs: StorePath[] = [];
  if (drv.src?.type === "path") {
    const srcPath = store.addSource(drv.src.path);
    inputSrcs = [srcPath];
  }
  
  // Handle builder path
  // System binaries like /bin/sh are used directly
  // Everything else is treated as a path to add to the store
  let builderPath: StorePath;
  if (drv.builder.startsWith('/')) {
    // System binary (e.g., /bin/sh, /usr/bin/env)
    builderPath = drv.builder as StorePath;
  } else if (drv.builder.startsWith(storeDir)) {
    // Already a store path
    builderPath = drv.builder as StorePath;
  } else {
    // Local file path — add to store
    builderPath = store.addSource(drv.builder, `${drv.name}-builder`);
    inputSrcs.push(builderPath);
  }
  
  // Build the DrvFile
  const inputDrvs: Record<string, string[]> = {};
  for (const [input, result] of inputResults) {
    inputDrvs[result.drvPath] = ["out"];
  }
  
  const drvFile: DrvFile = {
    outputs: { out: { path: outPath } },
    inputDrvs,
    inputSrcs,
    system,
    builder: builderPath,
    args: drv.args ?? [],
    env: {
      ...drv.env,
      out: outPath,
      name: drv.name,
      system,
      // Standard Nix build environment
      PATH: "/path-not-set",
      HOME: "/homeless-shelter",
      NIX_STORE: storeDir,
      // Add paths to all inputs
      ...Object.fromEntries(
        Array.from(inputResults.values()).map((r, i) => [`input${i}`, r.outPath])
      ),
    },
  };
  
  // Write the .drv to store
  store.addDrv(drvPath, drvFile);
  
  const result = { drvPath, outPath };
  cache.set(drv, result);
  return result;
}

// =============================================================================
// Dependency Graph Utilities
// =============================================================================

/**
 * Topologically sort derivations for build order.
 * Dependencies come before dependents.
 */
export function topoSort(
  drvs: Derivation[],
  cache: Map<Derivation, Derivation[]> = new Map()
): Derivation[] {
  const result: Derivation[] = [];
  const visited = new Set<Derivation>();
  const path: Derivation[] = []; // Track current path for error messages
  
  function visit(drv: Derivation): void {
    if (visited.has(drv)) return;
    
    // Check for cycle
    const cycleStart = path.indexOf(drv);
    if (cycleStart !== -1) {
      const cycle = [...path.slice(cycleStart), drv];
      const cycleStr = cycle.map(d => d.name).join(" -> ");
      throw new Error(`Circular dependency detected: ${cycleStr}`);
    }
    
    path.push(drv);
    for (const input of drv.inputs ?? []) {
      visit(input);
    }
    path.pop();
    
    visited.add(drv);
    result.push(drv);
  }
  
  for (const drv of drvs) {
    visit(drv);
  }
  
  return result;
}

/**
 * Get all transitive dependencies of a derivation.
 */
export function getAllDeps(drv: Derivation): Set<Derivation> {
  const deps = new Set<Derivation>();
  
  function collect(d: Derivation): void {
    for (const input of d.inputs ?? []) {
      if (!deps.has(input)) {
        deps.add(input);
        collect(input);
      }
    }
  }
  
  collect(drv);
  return deps;
}
