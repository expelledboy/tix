/**
 * Integration tests
 * 
 * End-to-end tests that verify the full pipeline works.
 */


import { Store } from '../core/store';
import { instantiate, hashDerivationModulo, topoSort } from '../core/derivation';
import { sh, drv, fetchUrl, env, outPath as getOutPath } from '../api';
import type { Derivation, Hash } from '../core/types';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('End-to-end pipeline', () => {
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tix-e2e-'));
    store = new Store({ storeDir: tempDir });
    // Point the global store to our temp store
    process.env.TIX_STORE = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.TIX_STORE;
  });

  describe('simple derivation', () => {
    it('hash → instantiate → drv file exists', () => {
      const drv = {
        name: 'simple',
        builder: '/bin/sh',
        args: ['-c', 'echo hello > $out'],
      };

      // Hash should work
      const hash = hashDerivationModulo(drv, tempDir);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);

      // Instantiate should create drv file
      const { drvPath, outPath } = instantiate(store, drv);
      expect(store.has(drvPath as any)).toBe(true);

      // Drv file should be valid JSON
      const drvContent = store.readDrv(drvPath);
      expect(drvContent).toHaveProperty('outputs');
      expect(drvContent).toHaveProperty('builder');
    });
  });

  describe('derivation with dependencies', () => {
    it('correctly chains hashes', () => {
      const leaf = drv({ name: 'leaf', builder: '/bin/sh', args: ['-c', 'echo leaf'] });
      const middle = drv({ name: 'middle', builder: '/bin/sh', inputs: [leaf] });
      const root = drv({ name: 'root', builder: '/bin/sh', inputs: [middle] });

      // All should hash without error
      const leafHash = hashDerivationModulo(leaf, tempDir);
      const middleHash = hashDerivationModulo(middle, tempDir);
      const rootHash = hashDerivationModulo(root, tempDir);

      // All hashes should be different
      expect(new Set([leafHash, middleHash, rootHash]).size).toBe(3);

      // Instantiation should create all drv files
      instantiate(store, root);
      
      const allPaths = store.list();
      const drvPaths = allPaths.filter(p => p.endsWith('.drv'));
      expect(drvPaths.length).toBe(3);  // leaf, middle, root
    });
  });

  describe('fixed-output derivations', () => {
    it('same content hash = same output path', () => {
      const hash = 'abc123'.padEnd(64, '0') as Hash;
      
      const fetcher1 = fetchUrl({
        name: 'file',
        url: 'http://mirror1.com/file',
        sha256: hash,
      });
      
      const fetcher2 = fetchUrl({
        name: 'file',
        url: 'http://mirror2.com/file',
        sha256: hash,
      });

      const { outPath: path1 } = instantiate(store, fetcher1);
      const { outPath: path2 } = instantiate(store, fetcher2);

      expect(path1).toBe(path2);
    });
  });

  describe('diamond dependencies', () => {
    it('shared dependency is only instantiated once', () => {
      const shared = drv({ name: 'shared', builder: '/bin/sh' });
      const left = drv({ name: 'left', builder: '/bin/sh', inputs: [shared] });
      const right = drv({ name: 'right', builder: '/bin/sh', inputs: [shared] });
      const top = drv({ name: 'top', builder: '/bin/sh', inputs: [left, right] });

      instantiate(store, top);

      // Should have 4 unique drv files
      const drvPaths = store.list().filter(p => p.endsWith('.drv'));
      expect(drvPaths.length).toBe(4);
    });
  });

  describe('build order', () => {
    it('topoSort produces valid build order', () => {
      const a = drv({ name: 'a', builder: '/bin/sh' });
      const b = drv({ name: 'b', builder: '/bin/sh', inputs: [a] });
      const c = drv({ name: 'c', builder: '/bin/sh', inputs: [a] });
      const d = drv({ name: 'd', builder: '/bin/sh', inputs: [b, c] });

      const sorted = topoSort([d]);
      const names = sorted.map(d => d.name);

      // 'a' must come before 'b' and 'c'
      expect(names.indexOf('a')).toBeLessThan(names.indexOf('b'));
      expect(names.indexOf('a')).toBeLessThan(names.indexOf('c'));
      // 'b' and 'c' must come before 'd'
      expect(names.indexOf('b')).toBeLessThan(names.indexOf('d'));
      expect(names.indexOf('c')).toBeLessThan(names.indexOf('d'));
    });
  });

  describe('reproducibility', () => {
    it('same derivation always produces same paths in same store', () => {
      const d = drv({
        name: 'reproducible',
        builder: '/bin/sh',
        args: ['-c', 'echo test'],
        env: { FOO: 'bar' },
      });

      // Instantiate twice in the same store
      const result1 = instantiate(store, d);
      const result2 = instantiate(store, d);

      // Same store → same paths (idempotent)
      expect(result1.drvPath).toBe(result2.drvPath);
      expect(result1.outPath).toBe(result2.outPath);
    });

    it('different store dirs produce different paths (by design)', () => {
      const d = drv({
        name: 'reproducible',
        builder: '/bin/sh',
        args: ['-c', 'echo test'],
      });

      const result1 = instantiate(store, d);
      
      const store2 = new Store({ storeDir: mkdtempSync(join(tmpdir(), 'tix-e2e2-')) });
      const result2 = instantiate(store2, d);

      // Different storeDir → different paths (storeDir is part of fingerprint)
      expect(result1.drvPath).not.toBe(result2.drvPath);
      expect(result1.outPath).not.toBe(result2.outPath);
      
      // But the human-readable NAME suffix should be the same
      const getName = (p: string) => p.split('/').pop()!.replace(/^[a-z0-9]+-/, '');
      expect(getName(result1.drvPath as string)).toBe(getName(result2.drvPath as string));

      rmSync(store2.dir, { recursive: true, force: true });
    });
  });
});

describe('Error handling', () => {
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tix-err-'));
    store = new Store({ storeDir: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('circular dependencies', () => {
    it('throws on direct cycle', () => {
      const a: any = drv({ name: 'a', builder: '/bin/sh' });
      const b: any = drv({ name: 'b', builder: '/bin/sh', inputs: [a] });
      a.inputs = [b];

      expect(() => topoSort([a])).toThrow();
    });

    it('throws on indirect cycle', () => {
      const a: any = drv({ name: 'a', builder: '/bin/sh' });
      const b: any = drv({ name: 'b', builder: '/bin/sh', inputs: [a] });
      const c: any = drv({ name: 'c', builder: '/bin/sh', inputs: [b] });
      a.inputs = [c];

      expect(() => topoSort([a])).toThrow();
    });
  });
});

describe('Complex scenarios', () => {
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tix-complex-'));
    store = new Store({ storeDir: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('realistic package scenario', () => {
    // Simulate: library → app → docker image
    const lib = drv({
      name: 'my-lib',
      builder: '/bin/sh',
      args: ['-c', 'mkdir -p $out/lib && echo "lib" > $out/lib/my-lib.so'],
    });

    const app = drv({
      name: 'my-app',
      builder: '/bin/sh',
      args: ['-c', 'mkdir -p $out/bin && echo "app" > $out/bin/my-app'],
      inputs: [lib],
      env: { LIB_PATH: '${my-lib}/lib' },
    });

    const dockerEnv = env({
      name: 'docker-env',
      packages: [app],
    });

    // Should all instantiate without error
    const { drvPath: libDrv } = instantiate(store, lib);
    const { drvPath: appDrv } = instantiate(store, app);
    const { drvPath: envDrv } = instantiate(store, dockerEnv);

    expect(store.has(libDrv as any)).toBe(true);
    expect(store.has(appDrv as any)).toBe(true);
    expect(store.has(envDrv as any)).toBe(true);

    // App drv should reference lib
    const appContent = store.readDrv(appDrv) as any;
    expect(Object.keys(appContent.inputDrvs).length).toBe(1);
  });

  it('handles deeply nested dependencies', () => {
    // Create a chain of 20 dependencies
    let current: Derivation = drv({ name: 'leaf-0', builder: '/bin/sh' });
    
    for (let i = 1; i < 20; i++) {
      current = drv({
        name: `level-${i}`,
        builder: '/bin/sh',
        inputs: [current],
      });
    }

    // Should not stack overflow
    expect(() => instantiate(store, current)).not.toThrow();
    
    // Should create all 20 drv files
    const drvPaths = store.list().filter(p => p.endsWith('.drv'));
    expect(drvPaths.length).toBe(20);
  });

  it('handles wide dependency tree', () => {
    // Create 50 leaf dependencies, all feeding into one root
    const leaves = Array.from({ length: 50 }, (_, i) => 
      drv({ name: `leaf-${i}`, builder: '/bin/sh' })
    );

    const root = drv({
      name: 'wide-root',
      builder: '/bin/sh',
      inputs: leaves,
    });

    expect(() => instantiate(store, root)).not.toThrow();
    
    const drvPaths = store.list().filter(p => p.endsWith('.drv'));
    expect(drvPaths.length).toBe(51);  // 50 leaves + 1 root
  });
});
