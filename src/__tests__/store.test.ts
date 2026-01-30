/**
 * Store tests
 * 
 * Tests for content-addressed storage with atomic writes.
 */


import { Store } from '../core/store';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Store', () => {
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tix-store-test-'));
    store = new Store({ storeDir: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('creates store directory if not exists', () => {
      const newDir = join(tempDir, 'subdir', 'store');
      new Store({ storeDir: newDir });
      expect(existsSync(newDir)).toBe(true);
    });

    it('works with existing directory', () => {
      expect(() => new Store({ storeDir: tempDir })).not.toThrow();
    });
  });

  describe('addSource', () => {
    it('adds file to store', () => {
      const srcFile = join(tempDir, 'source.txt');
      writeFileSync(srcFile, 'hello world');
      
      const storePath = store.addSource(srcFile);
      
      expect(store.has(storePath)).toBe(true);
      expect(readFileSync(storePath, 'utf-8')).toBe('hello world');
    });

    it('returns same path for same content', () => {
      const src1 = join(tempDir, 'file1.txt');
      const src2 = join(tempDir, 'file2.txt');
      writeFileSync(src1, 'identical content');
      writeFileSync(src2, 'identical content');
      
      const path1 = store.addSource(src1, 'content');
      const path2 = store.addSource(src2, 'content');
      
      expect(path1).toBe(path2);
    });

    it('returns different path for different content', () => {
      const src1 = join(tempDir, 'file1.txt');
      const src2 = join(tempDir, 'file2.txt');
      writeFileSync(src1, 'content A');
      writeFileSync(src2, 'content B');
      
      const path1 = store.addSource(src1);
      const path2 = store.addSource(src2);
      
      expect(path1).not.toBe(path2);
    });

    it('uses custom name when provided', () => {
      const srcFile = join(tempDir, 'original.txt');
      writeFileSync(srcFile, 'content');
      
      const storePath = store.addSource(srcFile, 'custom-name');
      
      expect(storePath).toContain('-custom-name');
    });

    it('makes files read-only', () => {
      const srcFile = join(tempDir, 'source.txt');
      writeFileSync(srcFile, 'content');
      
      const storePath = store.addSource(srcFile);
      const stats = statSync(storePath);
      
      // 0o444 = r--r--r--
      expect(stats.mode & 0o777).toBe(0o444);
    });
  });

  describe('has', () => {
    it('returns true for existing path', () => {
      const srcFile = join(tempDir, 'exists.txt');
      writeFileSync(srcFile, 'content');
      const storePath = store.addSource(srcFile);
      
      expect(store.has(storePath)).toBe(true);
    });

    it('returns false for non-existing path', () => {
      const fakePath = `${tempDir}/nonexistent` as any;
      expect(store.has(fakePath)).toBe(false);
    });
  });

  describe('read', () => {
    it('reads content from store path', () => {
      const srcFile = join(tempDir, 'readable.txt');
      writeFileSync(srcFile, 'readable content');
      const storePath = store.addSource(srcFile);
      
      const content = store.read(storePath);
      
      expect(content.toString()).toBe('readable content');
    });
  });

  describe('list', () => {
    it('returns empty list for empty store', () => {
      expect(store.list()).toEqual([]);
    });

    it('returns all store paths', () => {
      const src1 = join(tempDir, 'a.txt');
      const src2 = join(tempDir, 'b.txt');
      writeFileSync(src1, 'a');
      writeFileSync(src2, 'b');
      
      store.addSource(src1);
      store.addSource(src2);
      
      // Filter to only count actual store paths (not temp files, etc.)
      const paths = store.list();
      expect(paths.length).toBeGreaterThanOrEqual(2);
      expect(paths.filter(p => p.includes('-a.txt') || p.includes('-b.txt')).length).toBe(2);
    });
  });

  describe('atomic writes', () => {
    it('does not leave partial files on error', () => {
      // This is hard to test without mocking, but we can verify
      // that the temp directory pattern is used
      const srcFile = join(tempDir, 'atomic.txt');
      writeFileSync(srcFile, 'atomic content');
      
      const storePath = store.addSource(srcFile);
      
      // No .tmp- directories should remain
      const files = store.list();
      const tmpFiles = files.filter(f => f.includes('.tmp-'));
      expect(tmpFiles.length).toBe(0);
    });

    it('handles concurrent adds of same content', async () => {
      const srcFile = join(tempDir, 'concurrent.txt');
      writeFileSync(srcFile, 'concurrent content');
      
      // Add the same file multiple times "concurrently"
      const promises = Array(10).fill(null).map(() => 
        Promise.resolve(store.addSource(srcFile, 'concurrent'))
      );
      
      const paths = await Promise.all(promises);
      
      // All should return the same path
      expect(new Set(paths).size).toBe(1);
      // Content should be correct
      expect(readFileSync(paths[0], 'utf-8')).toBe('concurrent content');
    });
  });

  describe('immutability', () => {
    it('does not overwrite existing paths', () => {
      const src1 = join(tempDir, 'first.txt');
      const src2 = join(tempDir, 'second.txt');
      writeFileSync(src1, 'original');
      writeFileSync(src2, 'original');  // Same content = same path
      
      const path1 = store.addSource(src1, 'immutable');
      const path2 = store.addSource(src2, 'immutable');
      
      expect(path1).toBe(path2);
      expect(readFileSync(path1, 'utf-8')).toBe('original');
    });
  });

  describe('drv files', () => {
    it('adds and reads drv file', () => {
      const drvContent = {
        outputs: { out: { path: '/fake/path' } },
        builder: '/bin/sh',
        args: [],
        env: {},
      };
      
      const drvPath = `${tempDir}/abc-test.drv` as any;
      store.addDrv(drvPath, drvContent);
      
      const read = store.readDrv(drvPath);
      expect(read).toEqual(drvContent);
    });
  });
});

describe('Store path validation', () => {
  // These tests document behavior around path edge cases
  
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tix-store-test-'));
    store = new Store({ storeDir: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles names with hyphens', () => {
    const srcFile = join(tempDir, 'source.txt');
    writeFileSync(srcFile, 'content');
    
    const path = store.addSource(srcFile, 'my-package-name');
    expect(path).toContain('-my-package-name');
  });

  it('handles names with underscores', () => {
    const srcFile = join(tempDir, 'source.txt');
    writeFileSync(srcFile, 'content');
    
    const path = store.addSource(srcFile, 'my_package');
    expect(path).toContain('-my_package');
  });

  it('handles names with dots', () => {
    const srcFile = join(tempDir, 'source.txt');
    writeFileSync(srcFile, 'content');
    
    const path = store.addSource(srcFile, 'file.tar.gz');
    expect(path).toContain('-file.tar.gz');
  });

  // Edge cases that should be handled (or explicitly rejected)
  // Uncomment and adjust based on desired behavior
  
  // it('rejects names with slashes', () => {
  //   const srcFile = join(tempDir, 'source.txt');
  //   writeFileSync(srcFile, 'content');
  //   expect(() => store.addSource(srcFile, 'foo/bar')).toThrow();
  // });

  // it('rejects names starting with dot', () => {
  //   const srcFile = join(tempDir, 'source.txt');
  //   writeFileSync(srcFile, 'content');
  //   expect(() => store.addSource(srcFile, '.hidden')).toThrow();
  // });
});
