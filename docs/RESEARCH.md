# Nix Research Summary for Tix

*Research conducted with live internet access to nix.dev, nixos.org, and GitHub sources*

## Core Insight

Nix's power comes from **input-addressed derivations** with **content-addressed storage**.

```
outputs = f(inputs)
same inputs → same hash → same store path → can coexist with other versions
```

## The Store Path Algorithm

This is the critical piece. From [Nix Pill #18](https://github.com/NixOS/nix-pills/blob/master/pills/18-nix-store-paths.md):

### For Source Files
```
1. hash = sha256(NAR_serialize(file))
2. desc = "source:sha256:<hash>:/nix/store:<name>"
3. path = "/nix/store/" + base32(sha256(desc)[0:20]) + "-" + name
```

### For Derivation Outputs
```
1. Compute the .drv with EMPTY output paths
2. For each input .drv, replace its path with its hash (recursive!)
3. hash = sha256(modified_drv)
4. desc = "output:<output_name>:sha256:<hash>:/nix/store:<name>"
5. path = "/nix/store/" + base32(sha256(desc)[0:20]) + "-" + name
```

**Key insight**: The output path is computed BEFORE building, based only on inputs!

### For Fixed-Output Derivations (fetchers)
```
1. desc = "fixed:out:sha256:<declared_content_hash>:"
2. intermediate = sha256(desc)
3. final_desc = "output:out:sha256:<intermediate>:/nix/store:<name>"
4. path = "/nix/store/" + base32(sha256(final_desc)[0:20]) + "-" + name
```

This allows network fetches because the output is determined by its CONTENT hash, not inputs.

## The .drv File Format

From the [Nix manual](https://github.com/NixOS/nix/blob/master/doc/manual/source/store/derivation/index.md):

```json
{
  "/nix/store/<hash>-name.drv": {
    "outputs": {
      "out": { "path": "/nix/store/<hash>-name" }
    },
    "inputSrcs": ["/nix/store/...-source-file"],
    "inputDrvs": {
      "/nix/store/...-dependency.drv": ["out"]
    },
    "platform": "x86_64-linux",
    "builder": "/nix/store/.../bin/bash",
    "args": ["-e", "/nix/store/.../builder.sh"],
    "env": {
      "name": "...",
      "out": "/nix/store/...",
      "system": "x86_64-linux",
      "PATH": "/path-not-set",
      "HOME": "/homeless-shelter"
    }
  }
}
```

## Build Environment

From [Nix Pill #7](https://github.com/NixOS/nix-pills/blob/master/pills/07-working-derivation.md):

```bash
HOME="/homeless-shelter"           # Force no $HOME dependency
PATH="/path-not-set"               # Force explicit dependencies  
NIX_BUILD_TOP="/tmp/nix-build-..."  # Temp build directory
TMPDIR="/tmp/nix-build-..."
out="/nix/store/<hash>-<name>"      # Where to put outputs
```

**Critical**: Builder inherits NOTHING from the calling shell. Pure isolation.

## The Two Phases

1. **Evaluation** (pure, in Nix language / our TypeScript)
   - Parse derivation descriptions
   - Resolve dependency graph
   - Compute all hashes and output paths
   - Write .drv files to store

2. **Realization** (effectful, in sandbox)
   - Topo-sort the dependency graph
   - For each .drv: check cache, build if needed, install atomically

## Nix Complexity We Can Skip

| Nix Feature | Tix Approach |
|-------------|--------------|
| Nix language | TypeScript (already have!) |
| NAR format | tar or just copy |
| Nix daemon | Single-user, no daemon |
| Profiles/generations | Future feature |
| Multi-output | Single "out" for MVP |
| Patched linker | Use containers |
| ATerm .drv format | JSON |
| Flakes | ES modules |

## What Tix MUST Have

1. **Content-addressed store** with proper path computation
2. **Derivation files** (.drv.json) with all inputs captured
3. **Input hashing** that recursively includes dependency hashes
4. **Sandboxed builds** (Docker for MVP)
5. **Atomic installs** (build in temp, move to store)
6. **Fixed-output derivations** for network fetches

## Sources

- [Eelco Dolstra's PhD Thesis](https://nixos.org/~eelco/pubs/phd-thesis.pdf)
- [Nix Pills](https://nixos.org/guides/nix-pills/)
- [Nix Manual - Derivations](https://nix.dev/manual/nix/2.28/language/derivations)
- [Nix Manual - Store Paths](https://nix.dev/manual/nix/2.28/store/store-path.md)

---

## Deep Dive: Store Path Calculation (from Nix source)

This is the actual algorithm from the [Nix protocol spec](https://github.com/NixOS/nix/blob/master/doc/manual/source/protocols/store-path.md):

### The Formula

```
store-path = store-dir "/" digest "-" name
```

Where:
- `digest` = nix32(sha256(fingerprint)[0:20])  // truncate to 160 bits
- `fingerprint` = type ":sha256:" inner-digest ":" store-dir ":" name

### For Derivation Outputs (`type = "output:out"`)

```
inner-fingerprint = ATerm(derivation-modulo-fixed-outputs)
inner-digest = hex(sha256(inner-fingerprint))
fingerprint = "output:out:sha256:" + inner-digest + ":" + store-dir + ":" + name
digest = nix32(sha256(fingerprint)[0:20])
path = store-dir + "/" + digest + "-" + name
```

### The "Derivation Modulo" Transformation

This is **critical** — before hashing, the derivation is transformed:

1. Replace output paths with empty strings
2. For each input derivation:
   - If it's a **fixed-output derivation**: replace the drv path with a hash of `"fixed:out:" + hashAlgo + ":" + contentHash + ":"`
   - Otherwise: recursively compute its "derivation modulo" hash and use that

This means:
- Fixed-output derivations are identified by their **output content**, not their build recipe
- Regular derivations are identified by their **transitive input hashes**

### For Source Files (`type = "source"`)

```
inner-fingerprint = NAR(file-system-object)
inner-digest = hex(sha256(inner-fingerprint))
fingerprint = "source:sha256:" + inner-digest + ":" + store-dir + ":" + name
```

### For Fixed-Output Derivations

```
inner-fingerprint = "fixed:out:" + method + algo + ":" + hash + ":"
```

Where `method` is:
- `""` (empty) for flat file hashing
- `"r:"` for NAR (recursive/directory) hashing
- `"git:"` for git tree hashing

### Nix32 Encoding

Alphabet: `0123456789abcdfghijklmnpqrsvwxyz` (no e, o, u, t)

**Important**: Nix32 processes bytes from END to START (reverse of base16)!

```typescript
const NIX32_ALPHABET = "0123456789abcdfghijklmnpqrsvwxyz";

function nix32Encode(bytes: Uint8Array): string {
  // Nix32 encodes 5 bits at a time, processing from the END
  const len = Math.ceil(bytes.length * 8 / 5);
  let result = "";
  
  for (let n = len - 1; n >= 0; n--) {
    const b = n * 5;
    const i = Math.floor(b / 8);
    const j = b % 8;
    
    // Extract 5 bits
    let c = (bytes[i] >> j) & 0x1f;
    if (i + 1 < bytes.length && j > 3) {
      c |= (bytes[i + 1] << (8 - j)) & 0x1f;
    }
    
    result = NIX32_ALPHABET[c] + result;
  }
  
  return result;
}
```

---

## TypeScript Implementation Strategy

### Dependencies (minimal)

```json
{
  "dependencies": {
    "fast-json-stable-stringify": "^2.1.0"  // deterministic JSON
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x"
  }
}
```

### Key Design Decisions

1. **No NAR format** — use tar or recursive file hashing for MVP
2. **JSON .drv files** — not ATerm (simpler, readable)
3. **Docker for sandboxing** — use `dockerode` or shell out
4. **Single output** — just "out" for MVP, no multi-output
5. **Branded types** — use TypeScript's type system for StorePath, DrvPath, etc.

### Type Definitions

```typescript
// Branded types for type safety
type StorePath = string & { readonly __brand: "StorePath" };
type DrvPath = StorePath & { readonly __brand: "DrvPath" };
type Hash = string & { readonly __brand: "Hash" };

type System = "x86_64-linux" | "aarch64-linux" | "x86_64-darwin" | "aarch64-darwin";

interface Derivation {
  name: string;
  system: System;
  builder: string;  // Path to builder executable (in store)
  args?: string[];
  env?: Record<string, string>;
  inputs: Derivation[];  // Dependencies (NOT paths - actual derivations)
  src?: string | { path: string; hash: Hash };  // Source files
}

interface DrvFile {
  outputs: { out: { path: StorePath } };
  inputDrvs: Record<DrvPath, string[]>;  // drv path -> outputs needed
  inputSrcs: StorePath[];
  system: System;
  builder: StorePath;
  args: string[];
  env: Record<string, string>;
}

interface Store {
  dir: string;  // e.g., "/tix/store"
  has(path: StorePath): boolean;
  get(path: StorePath): string;
  add(path: string, content: Buffer | string): StorePath;
  addDerivation(drv: DrvFile): DrvPath;
}
```

### Core Functions

```typescript
// 1. Hash a derivation (recursive, handles fixed-output specially)
function hashDerivationModulo(drv: Derivation, cache: Map<Derivation, Hash>): Hash;

// 2. Compute output path before building
function computeOutputPath(store: Store, drv: Derivation): StorePath;

// 3. Write derivation to store
function instantiate(store: Store, drv: Derivation): DrvPath;

// 4. Build a derivation (or skip if exists)
async function realize(store: Store, drvPath: DrvPath): Promise<StorePath>;

// 5. Topo-sort for build order
function topoSort(drvs: DrvPath[]): DrvPath[];
```

---

## Implementation Phases

### Phase 1: Store & Hashing (~100 lines)
- Content-addressed store with atomic adds
- Nix32 encoding
- Deterministic JSON serialization
- Source file hashing

### Phase 2: Derivations (~100 lines)
- Derivation type and DrvFile format
- `hashDerivationModulo` with proper recursion
- `computeOutputPath` using the Nix algorithm
- `instantiate` to write .drv files

### Phase 3: Builder (~150 lines)
- Topo-sort dependencies
- Docker sandbox execution
- Environment setup (PATH=/path-not-set, etc.)
- Atomic install to store

### Phase 4: CLI (~50 lines)
- `tix build <file.ts#export>`
- `tix show <path>`
- `tix gc`

---

## Test Cases

1. **Deterministic hashing**: Same derivation → same hash
2. **Input sensitivity**: Change any input → different hash
3. **Fixed-output stability**: Same content hash → same path regardless of build recipe
4. **Transitive deps**: Change deep dependency → changes all dependents
5. **Build isolation**: Builder can't see /usr, no network
6. **Atomic installs**: Interrupted build doesn't corrupt store
