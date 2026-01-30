/**
 * Core type definitions for Tix
 */

// Branded Types
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type StorePath = Brand<string, "StorePath">;
export type DrvPath = Brand<StorePath, "DrvPath">;
export type Hash = Brand<string, "Hash">;
export type Nix32Hash = Brand<string, "Nix32Hash">;

// System Types
export type System = 
  | "x86_64-linux" 
  | "aarch64-linux" 
  | "x86_64-darwin" 
  | "aarch64-darwin";

export const currentSystem = (): System => {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const os = process.platform === "darwin" ? "darwin" : "linux";
  return `${arch}-${os}` as System;
};

// Source Types
export type Source = 
  | { type: "path"; path: string }
  | { type: "fixed"; url: string; hash: Hash; hashAlgo: "sha256" };

// Derivation (user-facing)
export interface Derivation {
  name: string;
  system?: System;
  builder: string | StorePath;
  args?: string[];
  env?: Record<string, string>;
  inputs?: Derivation[];
  src?: Source;
  outputHash?: Hash;
  outputHashAlgo?: "sha256";
  outputHashMode?: "flat" | "recursive";
}

// DrvFile (stored in store)
export interface DrvFile {
  outputs: { out: { path: StorePath } };
  inputDrvs: Record<string, string[]>;
  inputSrcs: StorePath[];
  system: System;
  builder: StorePath;
  args: string[];
  env: Record<string, string>;
}

export interface StoreConfig {
  storeDir: string;
}

export const DEFAULT_STORE_DIR = "/tix/store";
