/**
 * Tix User API
 * 
 * High-level, ergonomic API for defining derivations.
 * This is what users import and use.
 */

import type { Derivation, Source, StorePath, System } from "./core";
import { Store, instantiate, realize, topoSort, currentSystem } from "./core";

// =============================================================================
// Global Store (lazy initialized)
// =============================================================================

let globalStore: Store | null = null;

export function getStore(): Store {
  if (!globalStore) {
    const storeDir = process.env.TIX_STORE ?? "/tix/store";
    globalStore = new Store({ storeDir });
  }
  return globalStore;
}

// =============================================================================
// Derivation Builder API
// =============================================================================

/**
 * Create a shell-based derivation.
 * 
 * @example
 * ```ts
 * const hello = sh`
 *   echo "Hello, World!" > $out/hello.txt
 * `;
 * ```
 */
export function sh(
  strings: TemplateStringsArray,
  ...values: (string | Derivation | StorePath)[]
): Derivation {
  // Interpolate the template
  let script = "";
  for (let i = 0; i < strings.length; i++) {
    script += strings[i];
    if (i < values.length) {
      const val = values[i];
      if (typeof val === "string") {
        script += val;
      } else if ("name" in val) {
        // It's a Derivation - we'll get its output path after instantiation
        // For now, use a placeholder
        script += `\${${val.name}}`;
      }
    }
  }
  
  // Extract a name from the script (first non-empty line, sanitized)
  const firstLine = script.trim().split("\n")[0] ?? "script";
  const name = firstLine
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32) || "script";
  
  return {
    name,
    builder: "/bin/sh",
    args: ["-c", script],
    inputs: values.filter((v): v is Derivation => typeof v === "object" && "name" in v),
  };
}

/**
 * Create a derivation from explicit options.
 */
export function drv(options: {
  name: string;
  builder: string;
  args?: string[];
  env?: Record<string, string>;
  inputs?: Derivation[];
  src?: string; // Local path
  system?: System;
}): Derivation {
  return {
    name: options.name,
    system: options.system ?? currentSystem(),
    builder: options.builder,
    args: options.args,
    env: options.env,
    inputs: options.inputs,
    src: options.src ? { type: "path", path: options.src } : undefined,
  };
}

/**
 * Create a fixed-output derivation (for fetching).
 * The output is determined by its content hash, not the build recipe.
 */
export function fetchUrl(options: {
  name: string;
  url: string;
  sha256: string;
}): Derivation {
  return {
    name: options.name,
    builder: "/bin/sh",
    args: ["-c", `curl -L -o $out "${options.url}"`],
    outputHash: options.sha256 as any,
    outputHashAlgo: "sha256",
    outputHashMode: "flat",
  };
}

// =============================================================================
// Build API
// =============================================================================

/**
 * Build a derivation (and all its dependencies).
 * Returns the output path.
 */
export async function build(drv: Derivation): Promise<StorePath> {
  const store = getStore();
  const { drvPath } = instantiate(store, drv);
  return realize(store, drvPath, { verbose: true });
}

/**
 * Get the output path of a derivation without building it.
 */
export function outPath(drv: Derivation): StorePath {
  const store = getStore();
  const { outPath } = instantiate(store, drv);
  return outPath;
}

/**
 * Show the derivation file for a derivation.
 */
export function show(drv: Derivation): void {
  const store = getStore();
  const { drvPath } = instantiate(store, drv);
  const content = store.readDrv(drvPath);
  console.log(JSON.stringify(content, null, 2));
}

// =============================================================================
// Environment API
// =============================================================================

/**
 * Create a development environment from derivations.
 */
export function env(options: {
  name?: string;
  packages: Derivation[];
}): Derivation {
  const pkgPaths = options.packages.map((p, i) => `$input${i}`).join(":");
  
  return {
    name: options.name ?? "dev-env",
    builder: "/bin/sh",
    args: ["-c", `
      mkdir -p $out/bin
      for pkg in ${pkgPaths}; do
        if [ -d "$pkg/bin" ]; then
          ln -s "$pkg/bin/"* "$out/bin/" 2>/dev/null || true
        fi
      done
    `],
    inputs: options.packages,
  };
}

// =============================================================================
// Exports
// =============================================================================

export { Store, instantiate, realize, topoSort } from "./core";
export type { Derivation, StorePath, DrvPath } from "./core";
