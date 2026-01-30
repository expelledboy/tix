/**
 * Derivation hashing and instantiation tests
 * 
 * This tests the core algorithm that makes Nix work.
 */


import { 
  hashDerivationModulo, 
  instantiate, 
  topoSort,
  getAllDeps,
} from '../core/derivation';
import { Store } from '../core/store';
import type { Derivation, Hash } from '../core/types';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Helper to create a minimal derivation
const mkDrv = (name: string, overrides: Partial<Derivation> = {}): Derivation => ({
  name,
  builder: '/bin/sh',
  args: ['-c', `mkdir -p $out && echo "${name}" > $out/name`],
  ...overrides,
});

describe('hashDerivationModulo', () => {
  const storeDir = '/tix/store';

  describe('basic hashing', () => {
    it('produces consistent hash for same derivation', () => {
      const drv = mkDrv('test');
      const hash1 = hashDerivationModulo(drv, storeDir);
      const hash2 = hashDerivationModulo(drv, storeDir);
      expect(hash1).toBe(hash2);
    });

    it('produces 64 character hex hash', () => {
      const drv = mkDrv('test');
      const hash = hashDerivationModulo(drv, storeDir);
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('uses cache correctly', () => {
      const drv = mkDrv('test');
      const cache = new Map<Derivation, Hash>();
      
      const hash1 = hashDerivationModulo(drv, storeDir, cache);
      expect(cache.has(drv)).toBe(true);
      
      const hash2 = hashDerivationModulo(drv, storeDir, cache);
      expect(hash1).toBe(hash2);
    });
  });

  describe('input sensitivity', () => {
    it('different name → different hash', () => {
      const drv1 = mkDrv('foo');
      const drv2 = mkDrv('bar');
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('different builder → different hash', () => {
      const drv1 = mkDrv('test', { builder: '/bin/sh' });
      const drv2 = mkDrv('test', { builder: '/bin/bash' });
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('different args → different hash', () => {
      const drv1 = mkDrv('test', { args: ['-c', 'echo a'] });
      const drv2 = mkDrv('test', { args: ['-c', 'echo b'] });
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('args order matters', () => {
      const drv1 = mkDrv('test', { args: ['a', 'b'] });
      const drv2 = mkDrv('test', { args: ['b', 'a'] });
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('different env → different hash', () => {
      const drv1 = mkDrv('test', { env: { FOO: '1' } });
      const drv2 = mkDrv('test', { env: { FOO: '2' } });
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('additional env var → different hash', () => {
      const drv1 = mkDrv('test', { env: {} });
      const drv2 = mkDrv('test', { env: { FOO: '1' } });
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('different system → different hash', () => {
      const drv1 = mkDrv('test', { system: 'x86_64-linux' });
      const drv2 = mkDrv('test', { system: 'aarch64-linux' });
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });
  });

  describe('dependency hashing', () => {
    it('different input → different hash', () => {
      const depA = mkDrv('dep-a');
      const depB = mkDrv('dep-b');
      const drv1 = mkDrv('test', { inputs: [depA] });
      const drv2 = mkDrv('test', { inputs: [depB] });
      
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('input order should not matter (hashed by their hash, not order)', () => {
      // Inputs are sorted by their hash before hashing the derivation
      // This ensures reproducibility regardless of declaration order
      const depA = mkDrv('dep-a');
      const depB = mkDrv('dep-b');
      const drv1 = mkDrv('test', { inputs: [depA, depB] });
      const drv2 = mkDrv('test', { inputs: [depB, depA] });
      
      const hash1 = hashDerivationModulo(drv1, storeDir);
      const hash2 = hashDerivationModulo(drv2, storeDir);
      
      // Order doesn't matter — inputs sorted by hash
      expect(hash1).toBe(hash2)
    });

    it('transitive dependency change propagates', () => {
      const leaf1 = mkDrv('leaf', { args: ['-c', 'echo v1'] });
      const leaf2 = mkDrv('leaf', { args: ['-c', 'echo v2'] });
      const middle1 = mkDrv('middle', { inputs: [leaf1] });
      const middle2 = mkDrv('middle', { inputs: [leaf2] });
      const root1 = mkDrv('root', { inputs: [middle1] });
      const root2 = mkDrv('root', { inputs: [middle2] });
      
      // Changing leaf should change root
      expect(hashDerivationModulo(root1, storeDir))
        .not.toBe(hashDerivationModulo(root2, storeDir));
    });

    it('handles diamond dependencies correctly', () => {
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      const D = mkDrv('D');
      const B = mkDrv('B', { inputs: [D] });
      const C = mkDrv('C', { inputs: [D] });
      const A = mkDrv('A', { inputs: [B, C] });
      
      // Should not throw, should be consistent
      const hash1 = hashDerivationModulo(A, storeDir);
      const hash2 = hashDerivationModulo(A, storeDir);
      expect(hash1).toBe(hash2);
      
      // D's hash should only be computed once (check cache)
      const cache = new Map<Derivation, Hash>();
      hashDerivationModulo(A, storeDir, cache);
      expect(cache.has(D)).toBe(true);
      expect(cache.has(B)).toBe(true);
      expect(cache.has(C)).toBe(true);
      expect(cache.has(A)).toBe(true);
    });

    it('handles deep chains', () => {
      // A → B → C → D → E → F
      let current = mkDrv('F');
      for (const name of ['E', 'D', 'C', 'B', 'A']) {
        current = mkDrv(name, { inputs: [current] });
      }
      
      expect(() => hashDerivationModulo(current, storeDir)).not.toThrow();
    });
  });

  describe('fixed-output derivations', () => {
    it('hash based on output, not inputs', () => {
      const contentHash = 'a'.repeat(64) as Hash;
      
      // Two "fetchers" for the same content
      const fetcher1 = mkDrv('file', {
        builder: '/bin/sh',
        args: ['-c', 'curl http://a.com/file > $out'],
        outputHash: contentHash,
        outputHashAlgo: 'sha256',
        outputHashMode: 'flat',
      });
      
      const fetcher2 = mkDrv('file', {
        builder: '/bin/sh',
        args: ['-c', 'wget http://b.com/file -O $out'],
        outputHash: contentHash,
        outputHashAlgo: 'sha256',
        outputHashMode: 'flat',
      });
      
      // Different build scripts, same content hash → same derivation hash
      expect(hashDerivationModulo(fetcher1, storeDir))
        .toBe(hashDerivationModulo(fetcher2, storeDir));
    });

    it('different content hash → different derivation hash', () => {
      const hash1 = 'a'.repeat(64) as Hash;
      const hash2 = 'b'.repeat(64) as Hash;
      
      const drv1 = mkDrv('file', { outputHash: hash1, outputHashAlgo: 'sha256' });
      const drv2 = mkDrv('file', { outputHash: hash2, outputHashAlgo: 'sha256' });
      
      expect(hashDerivationModulo(drv1, storeDir))
        .not.toBe(hashDerivationModulo(drv2, storeDir));
    });

    it('different hash mode → different derivation hash', () => {
      const contentHash = 'a'.repeat(64) as Hash;
      
      const flat = mkDrv('file', {
        outputHash: contentHash,
        outputHashAlgo: 'sha256',
        outputHashMode: 'flat',
      });
      
      const recursive = mkDrv('file', {
        outputHash: contentHash,
        outputHashAlgo: 'sha256',
        outputHashMode: 'recursive',
      });
      
      expect(hashDerivationModulo(flat, storeDir))
        .not.toBe(hashDerivationModulo(recursive, storeDir));
    });
  });
});

describe('topoSort', () => {
  it('returns single derivation unchanged', () => {
    const drv = mkDrv('single');
    const sorted = topoSort([drv]);
    expect(sorted).toEqual([drv]);
  });

  it('orders dependencies before dependents', () => {
    const dep = mkDrv('dep');
    const main = mkDrv('main', { inputs: [dep] });
    
    const sorted = topoSort([main]);
    expect(sorted.indexOf(dep)).toBeLessThan(sorted.indexOf(main));
  });

  it('handles diamond dependencies', () => {
    const D = mkDrv('D');
    const B = mkDrv('B', { inputs: [D] });
    const C = mkDrv('C', { inputs: [D] });
    const A = mkDrv('A', { inputs: [B, C] });
    
    const sorted = topoSort([A]);
    
    // D must come before B and C
    expect(sorted.indexOf(D)).toBeLessThan(sorted.indexOf(B));
    expect(sorted.indexOf(D)).toBeLessThan(sorted.indexOf(C));
    // B and C must come before A
    expect(sorted.indexOf(B)).toBeLessThan(sorted.indexOf(A));
    expect(sorted.indexOf(C)).toBeLessThan(sorted.indexOf(A));
    // D should appear exactly once
    expect(sorted.filter(d => d === D).length).toBe(1);
  });

  it('detects circular dependencies', () => {
    // Create circular: A → B → A
    const A: Derivation = mkDrv('A');
    const B: Derivation = mkDrv('B', { inputs: [A] });
    (A as any).inputs = [B];  // Create cycle
    
    expect(() => topoSort([A])).toThrow(/[Cc]ircular/);
  });

  it('handles multiple roots', () => {
    const shared = mkDrv('shared');
    const root1 = mkDrv('root1', { inputs: [shared] });
    const root2 = mkDrv('root2', { inputs: [shared] });
    
    const sorted = topoSort([root1, root2]);
    
    expect(sorted.indexOf(shared)).toBeLessThan(sorted.indexOf(root1));
    expect(sorted.indexOf(shared)).toBeLessThan(sorted.indexOf(root2));
    expect(sorted.filter(d => d === shared).length).toBe(1);
  });
});

describe('getAllDeps', () => {
  it('returns empty set for no deps', () => {
    const drv = mkDrv('nodeps');
    expect(getAllDeps(drv).size).toBe(0);
  });

  it('returns direct dependencies', () => {
    const dep = mkDrv('dep');
    const main = mkDrv('main', { inputs: [dep] });
    
    const deps = getAllDeps(main);
    expect(deps.has(dep)).toBe(true);
    expect(deps.size).toBe(1);
  });

  it('returns transitive dependencies', () => {
    const deep = mkDrv('deep');
    const middle = mkDrv('middle', { inputs: [deep] });
    const shallow = mkDrv('shallow', { inputs: [middle] });
    
    const deps = getAllDeps(shallow);
    expect(deps.has(deep)).toBe(true);
    expect(deps.has(middle)).toBe(true);
    expect(deps.size).toBe(2);
  });

  it('deduplicates diamond dependencies', () => {
    const D = mkDrv('D');
    const B = mkDrv('B', { inputs: [D] });
    const C = mkDrv('C', { inputs: [D] });
    const A = mkDrv('A', { inputs: [B, C] });
    
    const deps = getAllDeps(A);
    expect(deps.size).toBe(3);  // B, C, D (not counting duplicates)
  });
});

describe('instantiate', () => {
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tix-test-'));
    store = new Store({ storeDir: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates drv file in store', () => {
    const drv = mkDrv('test');
    const { drvPath } = instantiate(store, drv);
    
    expect(store.has(drvPath as any)).toBe(true);
    expect(drvPath).toMatch(/\.drv$/);
  });

  it('computes correct output path', () => {
    const drv = mkDrv('test');
    const { outPath } = instantiate(store, drv);
    
    expect(outPath).toMatch(new RegExp(`^${tempDir}/[0-9a-df-np-sv-z]{32}-test$`));
  });

  it('is idempotent', () => {
    const drv = mkDrv('test');
    const result1 = instantiate(store, drv);
    const result2 = instantiate(store, drv);
    
    expect(result1.drvPath).toBe(result2.drvPath);
    expect(result1.outPath).toBe(result2.outPath);
  });

  it('instantiates dependencies first', () => {
    const dep = mkDrv('dep');
    const main = mkDrv('main', { inputs: [dep] });
    
    const { drvPath } = instantiate(store, main);
    const drvContent = store.readDrv(drvPath);
    
    // The drv file should reference the dep's drv path
    expect(Object.keys((drvContent as any).inputDrvs).length).toBe(1);
  });

  it('uses cache for repeated instantiation', () => {
    const drv = mkDrv('test');
    const cache = new Map();
    
    instantiate(store, drv, cache);
    expect(cache.has(drv)).toBe(true);
    
    // Second call should return cached result
    const result = instantiate(store, drv, cache);
    expect(result).toBe(cache.get(drv));
  });
});
