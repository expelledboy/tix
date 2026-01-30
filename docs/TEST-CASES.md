# Tix Test Cases — Edge Case Analysis

## 1. Hashing Edge Cases

### 1.1 Nix32 Encoding
- **Empty input**: What happens with 0 bytes?
- **Single byte**: Boundary condition (8 bits → 2 nix32 chars)
- **Exact boundary**: 5 bytes = 40 bits = exactly 8 nix32 chars
- **Off-by-one**: 6 bytes = 48 bits = 10 chars (with padding bits)
- **20 bytes (SHA256 truncated)**: The actual use case — must produce exactly 32 chars
- **Alphabet correctness**: Output must only contain `0123456789abcdfghijklmnpqrsvwxyz` (no e,o,u,t)
- **Byte order**: Nix32 is REVERSED — verify against known Nix outputs

### 1.2 Deterministic JSON
- **Key ordering**: `{b:1, a:2}` must serialize same as `{a:2, b:1}`
- **Nested objects**: Deep nesting must sort at every level
- **Arrays**: Order preserved (arrays are ordered, not sorted)
- **Mixed types**: Numbers, strings, booleans, nulls, nested
- **Unicode**: Strings with emoji, CJK, RTL characters
- **Special values**: `undefined` (should be omitted), `NaN`, `Infinity`
- **Circular references**: Should throw, not infinite loop

### 1.3 Store Path Computation
- **Known Nix paths**: Verify against actual `nix path-info` output
- **Name validation**: Names can't start with `.`, can't contain `/`, length limits
- **Store directory**: Different store dirs produce different paths
- **Empty fingerprint components**: What if name is empty?

## 2. Derivation Hashing Edge Cases

### 2.1 hashDerivationModulo
- **No inputs**: Leaf derivation, no dependencies
- **Single input**: One dependency
- **Diamond dependency**: A → B, A → C, B → D, C → D (D appears twice)
- **Deep chain**: A → B → C → D → E (5 levels deep)
- **Circular dependency**: A → B → A (must detect and error)
- **Self-reference**: A depends on A (edge case of circular)

### 2.2 Fixed-Output Derivations
- **Flat mode**: Single file, hash of content
- **Recursive mode**: Directory, hash of NAR
- **Same content, different recipe**: Two FODs fetching same file differently → same path
- **Same recipe, different hash**: Must produce different paths
- **Mixed graph**: FOD feeding into regular derivation

### 2.3 Input Sensitivity
- **Change builder**: Same everything else → different hash
- **Change args order**: `["a", "b"]` vs `["b", "a"]` → different
- **Change env value**: `{FOO: "1"}` vs `{FOO: "2"}` → different
- **Add env var**: `{}` vs `{FOO: "1"}` → different
- **Change input**: Swap dependency → different hash
- **Change transitive input**: Change D in A→B→C→D → A's hash changes

### 2.4 Hash Stability
- **Idempotent**: Same derivation hashed twice → same result
- **Cache correctness**: Cached hash matches fresh computation
- **Cross-platform**: Same derivation on different systems → same hash (if system matches)

## 3. Store Edge Cases

### 3.1 Atomic Writes
- **Concurrent writes**: Two processes adding same path simultaneously
- **Interrupted write**: Process killed mid-write → no corruption
- **Disk full**: Graceful error, no partial files
- **Permission denied**: Clear error message

### 3.2 Content Integrity
- **Immutability**: Can't overwrite existing path
- **Permission bits**: Files are 444, dirs are 555
- **Symlinks**: Preserve or reject?
- **Hard links**: Handle correctly
- **Special files**: Block devices, sockets (should reject)

### 3.3 Path Operations
- **Path exists**: True positive, true negative
- **Path outside store**: Reject attempts to read `/etc/passwd`
- **Relative paths**: Resolve correctly
- **Symlink escape**: `/tix/store/abc/../../../etc/passwd`

## 4. Build Edge Cases

### 4.1 Dependency Resolution
- **Empty deps**: Build with no inputs
- **Missing dep**: Dep not built yet → must build first
- **Already built**: Skip rebuild, return cached
- **Partial build**: Some deps built, some not

### 4.2 Build Isolation (Docker)
- **No network**: Can't reach internet (except FOD)
- **No /usr**: Only store paths available
- **Clean env**: No inherited variables
- **Temp dir cleanup**: /tmp cleared between builds
- **Output path creation**: Builder must create $out

### 4.3 Build Failures
- **Builder exits non-zero**: Clear error, no output registered
- **Builder doesn't create $out**: Error
- **Builder creates wrong content**: FOD hash mismatch
- **Builder timeout**: Configurable, clean termination
- **Builder OOM**: Handle gracefully

### 4.4 Fixed-Output Builds
- **Network allowed**: FOD can fetch
- **Hash mismatch**: Downloaded content doesn't match declared hash
- **Retry logic**: Network failures

## 5. API Edge Cases

### 5.1 sh`` Template
- **Empty template**: sh`` → valid derivation?
- **Interpolated derivation**: sh`${dep}` → adds to inputs
- **Interpolated string**: sh`${"literal"}` → just string
- **Mixed interpolation**: sh`${dep} and ${"string"}`
- **Multiline**: Preserves newlines
- **Special characters**: Quotes, backslashes, `$` signs

### 5.2 drv() Function
- **Minimal**: Just name and builder
- **Missing name**: Should error
- **Invalid name characters**: `foo/bar`, `foo bar`
- **Empty inputs array**: `inputs: []` vs `inputs: undefined`

### 5.3 fetchUrl()
- **Invalid URL**: Not a URL
- **Invalid hash**: Wrong length, invalid chars
- **Hash algorithm**: Only sha256 for now

## 6. CLI Edge Cases

### 6.1 File Loading
- **TypeScript file**: Needs ts-node or pre-compilation
- **Missing file**: Clear error
- **Syntax error**: Report location
- **Missing export**: `export` not found
- **Wrong export type**: Export is not a Derivation

### 6.2 Commands
- **Unknown command**: `tix foo` → help text
- **No args**: `tix` → help text
- **Extra args**: `tix build a b c` → ?

## 7. Cross-Cutting Concerns

### 7.1 Error Messages
- Every error should be:
  - Actionable (what to do)
  - Contextual (where it happened)
  - Not leak internals (no stack traces in production)

### 7.2 Performance
- **Large dependency graph**: 1000 derivations
- **Deep nesting**: 100 levels of deps
- **Hash cache effectiveness**: Don't rehash same drv
- **Parallel builds**: (future) Can build independent deps in parallel

### 7.3 Reproducibility
- **Timestamp independence**: Builds don't depend on current time
- **Locale independence**: Builds don't depend on LANG
- **Path independence**: Building on different machines → same result

---

## Deep Dive: The Subtle Bugs

### Bug Class 1: Hash Instability

**The Problem**: If two logically identical derivations produce different hashes, you get unnecessary rebuilds and cache misses.

**Causes**:
1. **Object key ordering**: `{a:1, b:2}` vs `{b:2, a:1}` in JSON
2. **Floating point**: `1.0` vs `1` in JSON
3. **Undefined vs missing**: `{a: undefined}` vs `{}`
4. **Array holes**: `[1,,3]` vs `[1,undefined,3]`
5. **Date serialization**: `new Date()` → depends on timezone?
6. **Symbol properties**: Should be ignored
7. **Prototype pollution**: `Object.prototype.foo = 1` leaking into hash

**Test Strategy**: Create pairs of "should be equal" and verify hashes match.

### Bug Class 2: Hash Collision Weakness

**The Problem**: Two different derivations producing the same hash = security/correctness disaster.

**Note**: SHA256 is collision-resistant, but our TRUNCATION to 160 bits reduces security. Birthday attack: ~2^80 operations to find collision. Acceptable for build systems, not for security-critical applications.

**Causes**:
1. **Truncation errors**: Wrong truncation (e.g., 128 bits instead of 160)
2. **Encoding errors**: Hex vs raw bytes confusion
3. **Fingerprint format**: Missing separator could cause `a:bc` = `ab:c`

**Test Strategy**: Verify against known Nix store paths.

### Bug Class 3: Diamond Dependency Double-Counting

```
    A
   / \
  B   C
   \ /
    D
```

**The Problem**: D's hash gets computed twice (once via B, once via C). If not cached, this is O(2^n) for deep diamonds.

**Worse Problem**: If cache key is wrong, D might hash differently via B vs C path, causing A to have unstable hash.

**Test Strategy**: 
1. Verify diamond computes in O(n) time
2. Verify hash is identical regardless of traversal order

### Bug Class 4: Fixed-Output Leakage

**The Problem**: Fixed-output derivations should be identified ONLY by their output hash. If any input leaks into the path computation, you get:
- Same content from different URLs → different paths (cache miss)
- Changing the fetch script breaks caches even though output is identical

**Test Strategy**:
```typescript
// These MUST produce the same output path:
const a = fetchUrl({ name: "foo", url: "http://a.com/file", sha256: "abc123" });
const b = fetchUrl({ name: "foo", url: "http://b.com/file", sha256: "abc123" });
assert(outPath(a) === outPath(b));
```

### Bug Class 5: Transitive Sensitivity

**The Problem**: Changing a deep dependency must change all dependents' hashes.

```
A (v1) → B → C → D
A (v2) → B' → C' → D'  // ALL must change
```

**If this fails**: You rebuild D but reuse old C, which was built against old D. Loading C might crash because it expects old D's interface.

**Test Strategy**: Change leaf, verify root hash changes.

### Bug Class 6: Build Environment Leakage

**The Problem**: If build environment isn't perfectly isolated, builds are non-reproducible.

**Leakage Sources**:
1. **Inherited env vars**: `PATH`, `HOME`, `LANG`, `TZ`
2. **Timestamps**: `__DATE__`, `__TIME__` in C, file mtimes
3. **Randomness**: UUIDs, `/dev/urandom` reads
4. **Parallelism**: Race conditions in parallel make
5. **Network**: DNS responses, HTTP headers
6. **Filesystem order**: `readdir()` order is undefined

**Test Strategy**: Build same derivation twice, compare outputs byte-for-byte.

### Bug Class 7: Atomic Write Races

**The Problem**: Two processes building the same derivation simultaneously.

**Scenario**:
1. Process A: checks if output exists → no
2. Process B: checks if output exists → no
3. Process A: starts building
4. Process B: starts building
5. Process A: writes output
6. Process B: writes output (overwrites A!)

**Correct Behavior**: Second writer should either:
- Fail gracefully (output already exists)
- Succeed silently (content is identical anyway)

**Test Strategy**: Parallel builds of same derivation.

### Bug Class 8: Symlink/Hardlink Confusion

**The Problem**: Store paths can contain symlinks. What if:
- Symlink points outside store? (escape)
- Symlink is relative vs absolute?
- Hardlink creates multiple paths to same inode?
- Symlink to another store path? (implicit dependency)

**Test Strategy**: Create derivations with various link types, verify behavior.

### Bug Class 9: Name Sanitization

**The Problem**: Store path names come from user input. What if:
- Name contains `/`? → Path traversal
- Name contains `\0`? → String truncation
- Name is `.` or `..`? → Special directory entries
- Name is very long? → Filesystem limits (255 chars typically)
- Name contains Unicode? → Normalization issues (é vs e+́)

**Test Strategy**: Fuzz derivation names, verify no crashes or escapes.

### Bug Class 10: Cache Invalidation

**The Problem**: If we cache computed hashes, cache must be invalidated correctly.

**Scenario**:
```typescript
const drv = { name: "foo", builder: "/bin/sh", args: ["-c", "echo hi"] };
const hash1 = hashDerivationModulo(drv, cache);
drv.args = ["-c", "echo bye"];  // Mutate!
const hash2 = hashDerivationModulo(drv, cache);
// If cache key is object identity, hash2 === hash1 (WRONG!)
```

**Our Defense**: Cache is keyed by Derivation object identity, and we assume derivations are immutable. If user mutates, they get what they deserve.

**Better Defense**: Deep-freeze derivations, or use value-based cache key.

---

## Priority Order for Tests

1. **Hash correctness** (Nix32, SHA256, fingerprint format) — foundation
2. **hashDerivationModulo** (recursion, fixed-output, diamond) — core algorithm  
3. **Store path computation** (verify against Nix) — compatibility
4. **Atomic writes** (concurrency, interruption) — data integrity
5. **Build isolation** (env vars, no network) — reproducibility
6. **API ergonomics** (sh``, drv(), edge inputs) — usability
7. **Error messages** (clear, actionable) — DX

