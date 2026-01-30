/**
 * Build execution for Tix
 * 
 * Implements:
 * - Sandboxed build execution (Docker)
 * - Build environment setup
 * - Output registration
 */

import { spawn, type SpawnOptions } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import type { DrvFile, StorePath, DrvPath } from "./types";
import { Store } from "./store";

// =============================================================================
// Build Configuration
// =============================================================================

export interface BuildConfig {
  /** Use Docker for sandboxing (recommended) */
  sandbox: "docker" | "none";
  /** Docker image for builds */
  dockerImage?: string;
  /** Allow network during build (only for fixed-output) */
  network?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

const DEFAULT_BUILD_CONFIG: BuildConfig = {
  sandbox: "docker",
  dockerImage: "debian:bookworm-slim",
  network: false,
  verbose: false,
};

// =============================================================================
// Build Execution
// =============================================================================

/**
 * Realize a derivation: build it if needed, return output path.
 */
export async function realize(
  store: Store,
  drvPath: DrvPath,
  config: Partial<BuildConfig> = {}
): Promise<StorePath> {
  const opts = { ...DEFAULT_BUILD_CONFIG, ...config };
  const drv = store.readDrv(drvPath) as DrvFile;
  const outPath = drv.outputs.out.path;
  
  // Already built?
  if (store.has(outPath)) {
    if (opts.verbose) console.log(`[tix] Already built: ${outPath}`);
    return outPath;
  }
  
  // Build all input derivations first
  for (const [inputDrvPath] of Object.entries(drv.inputDrvs)) {
    await realize(store, inputDrvPath as DrvPath, config);
  }
  
  // Now build this derivation
  if (opts.verbose) console.log(`[tix] Building: ${drvPath}`);
  
  if (opts.sandbox === "docker") {
    await buildInDocker(store, drv, opts);
  } else {
    await buildDirect(store, drv, opts);
  }
  
  // Verify output was created
  if (!store.has(outPath)) {
    throw new Error(`Build did not produce expected output: ${outPath}`);
  }
  
  if (opts.verbose) console.log(`[tix] Built: ${outPath}`);
  return outPath;
}

// =============================================================================
// Docker Sandbox Build
// =============================================================================

async function buildInDocker(
  store: Store,
  drv: DrvFile,
  config: BuildConfig
): Promise<void> {
  const outPath = drv.outputs.out.path;
  const outDir = join(tmpdir(), `tix-build-${basename(outPath)}`);
  
  // Create temp output directory
  mkdirSync(outDir, { recursive: true });
  
  // Build Docker command
  const dockerArgs = [
    "run",
    "--rm",
    // Network isolation (unless fixed-output)
    ...(config.network ? [] : ["--network", "none"]),
    // Mount store read-only
    "-v", `${store.dir}:${store.dir}:ro`,
    // Mount output directory
    "-v", `${outDir}:${outPath}:rw`,
    // Environment variables
    ...Object.entries(drv.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    // Working directory
    "-w", "/build",
    // Image
    config.dockerImage!,
    // Builder and args
    drv.builder,
    ...drv.args,
  ];
  
  if (config.verbose) {
    console.log(`[tix] docker ${dockerArgs.join(" ")}`);
  }
  
  await runCommand("docker", dockerArgs, { verbose: config.verbose });
  
  // Register the output
  store.registerOutput(outDir, outPath);
}

// =============================================================================
// Direct Build (no sandbox - for development/debugging)
// =============================================================================

async function buildDirect(
  store: Store,
  drv: DrvFile,
  config: BuildConfig
): Promise<void> {
  const outPath = drv.outputs.out.path;
  const buildDir = mkdtempSync(join(tmpdir(), "tix-build-"));
  
  // Create output directory
  mkdirSync(outPath, { recursive: true });
  
  // Sanitized environment
  const env: Record<string, string> = {
    ...drv.env,
    TMPDIR: buildDir,
    TEMPDIR: buildDir,
    TMP: buildDir,
    TEMP: buildDir,
  };
  
  await runCommand(drv.builder, drv.args, {
    cwd: buildDir,
    env,
    verbose: config.verbose,
  });
  
  // Register the output
  store.registerOutput(outPath, outPath);
}

// =============================================================================
// Command Execution
// =============================================================================

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  verbose?: boolean;
}

function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: options.cwd,
      env: options.env,
      stdio: options.verbose ? "inherit" : "pipe",
    };
    
    const child = spawn(command, args, spawnOpts);
    
    let stderr = "";
    if (!options.verbose && child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }
    
    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });
    
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}\n${stderr}`));
      }
    });
  });
}
