/**
 * Tix - A tiny, TypeScript reimagining of Nix
 * 
 * @packageDocumentation
 * 
 * @example
 * ```ts
 * import { sh, build } from 'tix';
 * 
 * const hello = sh`
 *   mkdir -p $out/bin
 *   echo '#!/bin/sh\necho Hello!' > $out/bin/hello
 *   chmod +x $out/bin/hello
 * `;
 * 
 * const outPath = await build(hello);
 * ```
 */

// Re-export the user-facing API
export {
  /** Create a shell-based derivation using template literals */
  sh,
  /** Create a derivation from explicit options */
  drv,
  /** Create a fixed-output derivation that fetches a URL */
  fetchUrl,
  /** Create a development environment from packages */
  env,
  
  /** Build a derivation and return the output path */
  build,
  /** Get the output path without building */
  outPath,
  /** Print the derivation JSON */
  show,
  
  /** Get the global store instance */
  getStore,
  /** The Store class for advanced usage */
  Store,
  
  /** Lower-level: Convert Derivation to DrvFile and write to store */
  instantiate,
  /** Lower-level: Build a derivation from its .drv path */
  realize,
  /** Lower-level: Sort derivations in dependency order */
  topoSort,
} from "./api";

// Re-export types
export type {
  /** A derivation specification (user-facing) */
  Derivation,
  /** A path in the content-addressed store */
  StorePath,
  /** A path to a .drv file in the store */
  DrvPath,
  /** Target system (e.g., "x86_64-linux") */
  System,
} from "./core";
