/**
 * The Tix Store
 * 
 * Content-addressed, immutable storage for build artifacts.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, chmodSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { StorePath, DrvPath, Hash, StoreConfig } from "./types";
import { sha256Hex, computeSourcePath } from "./hash";

export class Store {
  readonly dir: string;
  
  constructor(config: Partial<StoreConfig> = {}) {
    this.dir = config.storeDir ?? "/tix/store";
    this.ensureDir();
  }
  
  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true, mode: 0o755 });
    }
  }
  
  // ===========================================================================
  // Query
  // ===========================================================================
  
  /** Check if a path exists in the store */
  has(path: StorePath): boolean {
    return existsSync(path);
  }
  
  /** Get all store paths */
  list(): StorePath[] {
    return readdirSync(this.dir).map(name => 
      join(this.dir, name) as StorePath
    );
  }
  
  /** Read content from a store path */
  read(path: StorePath): Buffer {
    return readFileSync(path);
  }
  
  /** Read a derivation file */
  readDrv(path: DrvPath): unknown {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  }
  
  // ===========================================================================
  // Add Content
  // ===========================================================================
  
  /**
   * Add a source file to the store.
   * Returns the computed store path.
   */
  addSource(localPath: string, name?: string): StorePath {
    const content = readFileSync(localPath);
    const contentHash = sha256Hex(content);
    const finalName = name ?? basename(localPath);
    const storePath = computeSourcePath(contentHash, this.dir, finalName);
    
    if (!this.has(storePath)) {
      this.atomicWrite(storePath, content);
    }
    
    return storePath;
  }
  
  /**
   * Add raw content to the store with a pre-computed path.
   * Used internally when we already know the store path.
   */
  addWithPath(storePath: StorePath, content: Buffer | string): void {
    if (!this.has(storePath)) {
      this.atomicWrite(storePath, content);
    }
  }
  
  /**
   * Add a derivation file to the store.
   */
  addDrv(drvPath: DrvPath, drv: unknown): void {
    const content = JSON.stringify(drv, null, 2);
    this.addWithPath(drvPath as StorePath, content);
  }
  
  // ===========================================================================
  // Atomic Operations
  // ===========================================================================
  
  /**
   * Atomically write content to the store.
   * 
   * 1. Write to temp file
   * 2. Rename to final path (atomic on POSIX)
   * 3. Make read-only
   */
  private atomicWrite(storePath: StorePath, content: Buffer | string): void {
    // Create temp file in the same filesystem (for atomic rename)
    const tempDir = mkdtempSync(join(this.dir, ".tmp-"));
    const tempPath = join(tempDir, "content");
    
    try {
      // Write content
      writeFileSync(tempPath, content);
      
      // Make read-only
      chmodSync(tempPath, 0o444);
      
      // Atomic rename
      renameSync(tempPath, storePath);
    } finally {
      // Clean up temp dir
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  
  /**
   * Register a built output path.
   * Called after a build completes to move results into the store.
   */
  registerOutput(tempPath: string, storePath: StorePath): void {
    if (this.has(storePath)) {
      // Already exists, just clean up temp
      rmSync(tempPath, { recursive: true, force: true });
      return;
    }
    
    // Make immutable recursively
    this.makeImmutable(tempPath);
    
    // Atomic move
    renameSync(tempPath, storePath);
  }
  
  private makeImmutable(path: string): void {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        this.makeImmutable(join(path, entry));
      }
      chmodSync(path, 0o555); // r-xr-xr-x for dirs
    } else {
      chmodSync(path, 0o444); // r--r--r-- for files
    }
  }
}
