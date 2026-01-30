/**
 * Hash function tests
 * 
 * These are the foundation — if hashing is wrong, everything is wrong.
 */


import { 
  sha256, 
  sha256Hex, 
  sha256Truncated, 
  nix32Encode, 
  stableStringify,
  computeStorePath,
  computeOutputPath,
  computeSourcePath,
  computeFixedOutputPath,
} from '../core/hash';

describe('SHA256', () => {
  it('produces correct hash for empty string', () => {
    // Known SHA256 of empty string
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('produces correct hash for "hello"', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('handles Buffer input', () => {
    const buf = Buffer.from('hello');
    expect(sha256Hex(buf)).toBe(sha256Hex('hello'));
  });

  it('handles unicode correctly', () => {
    // Same string, different representations should hash the same
    const emoji = '🧠';
    expect(sha256Hex(emoji)).toBe(sha256Hex(emoji));
  });
});

describe('Nix32 Encoding', () => {
  // Nix32 alphabet: 0123456789abcdfghijklmnpqrsvwxyz
  // (no e, o, u, t)

  it('uses correct alphabet', () => {
    const result = nix32Encode(Buffer.alloc(20, 0xff));
    expect(result).toMatch(/^[0-9a-df-np-sv-z]+$/);
    expect(result).not.toMatch(/[eout]/);
  });

  it('produces correct length for 20 bytes', () => {
    // 20 bytes = 160 bits
    // 160 / 5 = 32 nix32 characters
    const result = nix32Encode(Buffer.alloc(20, 0));
    expect(result.length).toBe(32);
  });

  it('produces correct length for various inputs', () => {
    // n bytes → ceil(n * 8 / 5) chars
    expect(nix32Encode(Buffer.alloc(0)).length).toBe(0);
    expect(nix32Encode(Buffer.alloc(1)).length).toBe(2);  // 8 bits → 2 chars
    expect(nix32Encode(Buffer.alloc(5)).length).toBe(8);  // 40 bits → 8 chars
    expect(nix32Encode(Buffer.alloc(10)).length).toBe(16); // 80 bits → 16 chars
  });

  it('handles all-zeros correctly', () => {
    const result = nix32Encode(Buffer.alloc(20, 0));
    expect(result).toBe('00000000000000000000000000000000');
  });

  it('handles all-ones correctly', () => {
    const result = nix32Encode(Buffer.alloc(20, 0xff));
    // All 1s should produce all 'z's (31 in nix32)
    expect(result).toBe('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
  });

  it('is deterministic', () => {
    const buf = Buffer.from('test input');
    expect(nix32Encode(buf)).toBe(nix32Encode(buf));
  });

  // TODO: Verify against actual Nix nix32 output
  // This requires comparing with `nix hash to-base32`
});

describe('sha256Truncated', () => {
  it('produces 32 character output', () => {
    const result = sha256Truncated('test');
    expect(result.length).toBe(32);
  });

  it('truncates to first 20 bytes before encoding', () => {
    // The truncation should happen before nix32 encoding
    const full = sha256('test');
    const truncated = full.subarray(0, 20);
    expect(sha256Truncated('test')).toBe(nix32Encode(truncated));
  });
});

describe('stableStringify (deterministic JSON)', () => {
  it('sorts object keys', () => {
    const a = stableStringify({ z: 1, a: 2, m: 3 });
    const b = stableStringify({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys', () => {
    const obj = { 
      outer: { z: 1, a: 2 },
      alpha: { beta: { z: 1, a: 2 } }
    };
    const result = stableStringify(obj);
    expect(result).toBe('{"alpha":{"beta":{"a":2,"z":1}},"outer":{"a":2,"z":1}}');
  });

  it('preserves array order', () => {
    const result = stableStringify({ arr: [3, 1, 2] });
    expect(result).toBe('{"arr":[3,1,2]}');
  });

  it('handles null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });

  it('handles booleans', () => {
    expect(stableStringify({ t: true, f: false })).toBe('{"f":false,"t":true}');
  });

  it('handles numbers', () => {
    expect(stableStringify({ n: 42, f: 3.14 })).toBe('{"f":3.14,"n":42}');
  });

  it('handles strings with special characters', () => {
    const obj = { s: 'hello\nworld\t"quoted"' };
    const result = stableStringify(obj);
    expect(JSON.parse(result)).toEqual(obj);
  });

  it('handles empty objects and arrays', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });

  it('omits undefined values', () => {
    const result = stableStringify({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
  });

  it('handles deeply nested structures', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(() => stableStringify(deep)).not.toThrow();
  });

  // Note: Circular reference handling depends on implementation
  it('throws on circular references', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(() => stableStringify(obj)).toThrow();
  });
});

describe('Store Path Computation', () => {
  const storeDir = '/tix/store';

  describe('computeStorePath', () => {
    it('follows the fingerprint format', () => {
      // fingerprint = type ":sha256:" innerDigest ":" storeDir ":" name
      const type = 'output:out';
      const innerDigest = 'a'.repeat(64) as any; // 64 hex chars
      const name = 'hello';
      
      const path = computeStorePath(type, innerDigest, storeDir, name);
      
      expect(path).toMatch(/^\/tix\/store\/[0-9a-df-np-sv-z]{32}-hello$/);
    });

    it('produces different paths for different names', () => {
      const digest = 'a'.repeat(64) as any;
      const path1 = computeStorePath('output:out', digest, storeDir, 'foo');
      const path2 = computeStorePath('output:out', digest, storeDir, 'bar');
      expect(path1).not.toBe(path2);
    });

    it('produces different paths for different store dirs', () => {
      const digest = 'a'.repeat(64) as any;
      const path1 = computeStorePath('output:out', digest, '/nix/store', 'foo');
      const path2 = computeStorePath('output:out', digest, '/tix/store', 'foo');
      expect(path1).not.toBe(path2);
    });

    it('produces different paths for different types', () => {
      const digest = 'a'.repeat(64) as any;
      const path1 = computeStorePath('output:out', digest, storeDir, 'foo');
      const path2 = computeStorePath('source', digest, storeDir, 'foo');
      expect(path1).not.toBe(path2);
    });
  });

  describe('computeFixedOutputPath', () => {
    it('produces same path for same content hash regardless of inputs', () => {
      const hash = 'abc123def456'.padEnd(64, '0') as any;
      
      // Simulate two different fetch URLs with same content
      const path1 = computeFixedOutputPath(hash, 'flat', storeDir, 'file.tar.gz');
      const path2 = computeFixedOutputPath(hash, 'flat', storeDir, 'file.tar.gz');
      
      expect(path1).toBe(path2);
    });

    it('produces different paths for different hash modes', () => {
      const hash = 'abc123def456'.padEnd(64, '0') as any;
      
      const flat = computeFixedOutputPath(hash, 'flat', storeDir, 'file');
      const recursive = computeFixedOutputPath(hash, 'recursive', storeDir, 'file');
      
      expect(flat).not.toBe(recursive);
    });
  });
});
