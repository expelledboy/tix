/**
 * User-facing API tests
 * 
 * Tests for the ergonomic API (sh``, drv(), etc.)
 */


import { sh, drv, fetchUrl, env } from '../api';
import type { Derivation } from '../core/types';

describe('sh template literal', () => {
  it('creates a derivation from shell script', () => {
    const result = sh`echo "hello"`;
    
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('builder');
    expect(result.builder).toBe('/bin/sh');
    expect(result.args).toContain('-c');
  });

  it('interpolates strings', () => {
    const msg = 'world';
    const result = sh`echo "hello ${msg}"`;
    
    expect(result.args?.[1]).toContain('world');
  });

  it('interpolates derivations as inputs', () => {
    const dep = drv({ name: 'dep', builder: '/bin/sh', args: [] });
    const result = sh`${dep}/bin/run`;
    
    expect(result.inputs).toContain(dep);
  });

  it('handles multiline scripts', () => {
    const result = sh`
      set -e
      mkdir -p $out
      echo "line 1"
      echo "line 2"
    `;
    
    expect(result.args?.[1]).toContain('line 1');
    expect(result.args?.[1]).toContain('line 2');
  });

  it('handles empty template', () => {
    const result = sh``;
    
    expect(result).toHaveProperty('name');
    expect(result.args?.[1]).toBe('');
  });

  it('extracts name from first line', () => {
    const result = sh`my-build-script --flag`;
    
    // Name should be derived from first meaningful content
    expect(result.name).toBeTruthy();
    expect(result.name.length).toBeLessThanOrEqual(32);
  });

  it('sanitizes derived name', () => {
    const result = sh`
      #!/bin/bash
      echo "hello world!"
    `;
    
    // Name should not contain invalid characters
    expect(result.name).toMatch(/^[a-zA-Z0-9-_]+$/);
  });
});

describe('drv function', () => {
  it('creates minimal derivation', () => {
    const result = drv({
      name: 'minimal',
      builder: '/bin/sh',
    });
    
    expect(result.name).toBe('minimal');
    expect(result.builder).toBe('/bin/sh');
  });

  it('includes optional fields', () => {
    const result = drv({
      name: 'full',
      builder: '/bin/sh',
      args: ['-c', 'echo hi'],
      env: { FOO: 'bar' },
      system: 'x86_64-linux',
    });
    
    expect(result.args).toEqual(['-c', 'echo hi']);
    expect(result.env).toEqual({ FOO: 'bar' });
    expect(result.system).toBe('x86_64-linux');
  });

  it('defaults system to current', () => {
    const result = drv({
      name: 'test',
      builder: '/bin/sh',
    });
    
    expect(result.system).toBeTruthy();
  });

  it('accepts inputs', () => {
    const dep = drv({ name: 'dep', builder: '/bin/sh' });
    const result = drv({
      name: 'main',
      builder: '/bin/sh',
      inputs: [dep],
    });
    
    expect(result.inputs).toContain(dep);
  });

  it('accepts src path', () => {
    const result = drv({
      name: 'with-src',
      builder: '/bin/sh',
      src: './src',
    });
    
    expect(result.src).toEqual({ type: 'path', path: './src' });
  });
});

describe('fetchUrl function', () => {
  it('creates fixed-output derivation', () => {
    const result = fetchUrl({
      name: 'download',
      url: 'https://example.com/file.tar.gz',
      sha256: 'a'.repeat(64),
    });
    
    expect(result.outputHash).toBe('a'.repeat(64));
    expect(result.outputHashAlgo).toBe('sha256');
    expect(result.outputHashMode).toBe('flat');
  });

  it('includes URL in build script', () => {
    const result = fetchUrl({
      name: 'download',
      url: 'https://example.com/file.tar.gz',
      sha256: 'a'.repeat(64),
    });
    
    expect(result.args?.[1]).toContain('https://example.com/file.tar.gz');
  });
});

describe('env function', () => {
  it('creates environment derivation', () => {
    const pkg = drv({ name: 'pkg', builder: '/bin/sh' });
    const result = env({
      packages: [pkg],
    });
    
    expect(result.name).toBe('dev-env');
    expect(result.inputs).toContain(pkg);
  });

  it('accepts custom name', () => {
    const result = env({
      name: 'my-env',
      packages: [],
    });
    
    expect(result.name).toBe('my-env');
  });

  it('handles empty packages', () => {
    const result = env({
      packages: [],
    });
    
    expect(result.inputs).toEqual([]);
  });

  it('links bins from multiple packages', () => {
    const pkg1 = drv({ name: 'pkg1', builder: '/bin/sh' });
    const pkg2 = drv({ name: 'pkg2', builder: '/bin/sh' });
    const result = env({
      packages: [pkg1, pkg2],
    });
    
    expect(result.inputs?.length).toBe(2);
  });
});

describe('Derivation type safety', () => {
  it('Derivation objects have required fields', () => {
    const d: Derivation = {
      name: 'test',
      builder: '/bin/sh',
    };
    
    // TypeScript ensures these exist
    expect(d.name).toBeDefined();
    expect(d.builder).toBeDefined();
    
    // Optional fields can be undefined
    expect(d.inputs).toBeUndefined();
  });
});
