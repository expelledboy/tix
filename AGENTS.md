# AGENTS.md

This file provides context for AI coding assistants (Cursor, GitHub Copilot, Claude Code, OpenClaw, etc.) working with the Tix repository.

## Project Overview

**Tix** is a tiny, TypeScript reimagining of Nix — content-addressed builds without the DSL.

- **Repository**: https://github.com/expelledboy/tix
- **License**: MIT

### What Tix Does

Tix brings Nix's core ideas to TypeScript:
- **Content-addressed store**: `/tix/store/<hash>-<name>`
- **Reproducible builds**: Same inputs → same hash → same output
- **Sandboxed execution**: Docker-based isolation
- **Declarative**: TypeScript is the configuration language

### What Tix Is NOT

- Not a Nix replacement (much simpler, fewer features)
- Not production-ready yet (0.x version)
- Not compatible with Nix store or nixpkgs

## Repository Structure

```
tix/
├── src/
│   ├── core/           # Core implementation (low-level)
│   │   ├── types.ts    # Type definitions, branded types
│   │   ├── hash.ts     # SHA256, Nix32, store path computation  
│   │   ├── store.ts    # Content-addressed store
│   │   ├── derivation.ts # Hash algorithm, instantiation
│   │   ├── build.ts    # Docker sandbox execution
│   │   └── index.ts    # Core exports
│   ├── api.ts          # User-facing API (sh, drv, fetchUrl, env)
│   ├── cli.ts          # CLI entry point
│   ├── index.ts        # Public exports
│   └── __tests__/      # Test files
├── examples/           # Usage examples
├── docs/               # Documentation and research notes
├── dist/               # Build output (gitignored)
└── coverage/           # Test coverage (gitignored)
```

## Development Setup

### Requirements

- **Node.js**: >=18
- **pnpm**: Package manager
- **Docker**: For sandboxed builds (optional for tests)

### With Nix (recommended)

```bash
nix develop
```

### Without Nix

```bash
pnpm install
```

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript to dist/ |
| `pnpm dev` | Watch mode compilation |
| `pnpm test` | Run all tests |
| `pnpm test -- --coverage` | Run tests with coverage |
| `pnpm test -- --watch` | Watch mode testing |
| `pnpm lint` | Check formatting (Prettier) |
| `pnpm format` | Fix formatting |

### Running After Changes

Always run these before committing:

```bash
pnpm build      # Ensure it compiles
pnpm test       # Ensure tests pass
pnpm lint       # Ensure formatting is correct
```

## Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│  User Code: import { sh, drv, build } from 'tix'    │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  src/api.ts — High-level API                        │
│  • sh`` template literal                            │
│  • drv() explicit derivation                        │
│  • fetchUrl() fixed-output                          │
│  • build() / outPath() / show()                     │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  src/core/ — Low-level implementation               │
│  • types.ts: Branded types (StorePath, DrvPath)     │
│  • hash.ts: Nix32 encoding, SHA256, fingerprints    │
│  • derivation.ts: hashDerivationModulo, instantiate │
│  • store.ts: Content-addressed storage              │
│  • build.ts: Docker sandbox execution               │
└─────────────────────────────────────────────────────┘
```

### Key Concepts

1. **Derivation** (user-facing): What the user defines — name, builder, args, inputs
2. **DrvFile** (stored): What gets written to the store as JSON
3. **hashDerivationModulo**: The recursive hash algorithm that makes it all work
4. **Store**: Content-addressed, immutable file storage

### The Hash Algorithm

This is the core insight from Nix:

```typescript
function hashDerivationModulo(drv: Derivation): Hash {
  // Fixed-output: hash based on OUTPUT content, not inputs
  if (drv.outputHash) {
    return sha256(`fixed:out:sha256:${drv.outputHash}:`);
  }
  
  // Regular: hash includes ALL inputs recursively
  const inputHashes = drv.inputs.map(i => hashDerivationModulo(i));
  return sha256({ name, builder, args, env, inputs: inputHashes });
}
```

This means:
- Change any input → different hash → different output path
- Fixed-output derivations are identified by their content

## Coding Standards

### TypeScript

- **Strict mode**: Enabled, do not disable
- **ES Modules**: Use `import`/`export`, never `require()`
- **Branded types**: Use `StorePath`, `DrvPath`, `Hash` — don't use plain strings

### Formatting

- **Tool**: Prettier
- **Config**: `.prettierrc`
- **Settings**: Single quotes, trailing commas, 2-space indent, 100 char lines
- **Run**: `pnpm format` before committing

### File Naming

- Source files: `kebab-case.ts`
- Test files: `*.test.ts` in `__tests__/` directory

### Testing

- **Framework**: Jest with ts-jest
- **Location**: `src/__tests__/*.test.ts`
- **Pattern**: One test file per module (hash.test.ts, store.test.ts, etc.)

Test categories:
- `hash.test.ts`: Hashing, Nix32 encoding, deterministic JSON
- `store.test.ts`: Store operations, atomic writes, immutability
- `derivation.test.ts`: hashDerivationModulo, topoSort, instantiate
- `api.test.ts`: User API (sh, drv, fetchUrl, env)
- `integration.test.ts`: End-to-end scenarios

### Error Handling

- Throw descriptive `Error` with context
- Include the derivation name in errors
- For cycles, include the full path: `a -> b -> c -> a`

## Important Implementation Details

### Nix32 Encoding

Nix uses a custom base32 that:
1. Omits letters e, o, u, t (avoid confusion with 0, 1)
2. **Reverses bytes before encoding**
3. Outputs characters in reverse order

```typescript
// Alphabet: 0123456789abcdfghijklmnpqrsvwxyz (no e, o, u, t)
const reversed = Buffer.from(bytes).reverse();  // Critical!
```

### Store Path Format

```
/tix/store/<hash>-<name>

hash = nix32(sha256(fingerprint)[0:20])  // 32 chars
fingerprint = "output:out:sha256:<drvHash>:<storeDir>:<name>"
```

### Branded Types

We use branded types for type safety:

```typescript
type StorePath = string & { readonly __brand: "StorePath" };
type DrvPath = StorePath & { readonly __brand: "DrvPath" };
```

When you need string methods, cast: `(path as string).split('/')`

### Atomic Writes

All store writes must be atomic:
1. Write to temp file in same filesystem
2. `rename()` to final path (atomic on POSIX)
3. Set read-only permissions

## Common Tasks

### Adding a New API Function

1. Add to `src/api.ts`
2. Export from `src/index.ts` with JSDoc
3. Add tests in `src/__tests__/api.test.ts`
4. Add example in `examples/`

### Modifying the Hash Algorithm

⚠️ **Be extremely careful** — this affects all store paths.

1. Understand the Nix spec first (see `docs/RESEARCH.md`)
2. Add tests BEFORE changing code
3. Verify against real Nix output if possible
4. Update `docs/RESEARCH.md` with any findings

### Adding a Test

```typescript
describe('featureName', () => {
  it('does specific thing', () => {
    const result = functionUnderTest(input);
    expect(result).toBe(expectedOutput);
  });
});
```

For tests needing temp directories:

```typescript
let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'tix-test-'));
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
```

## Do NOT

- Use `JSON.parse()` directly on untrusted input
- Disable TypeScript strict mode
- Use `any` type (use `unknown` and narrow)
- Commit without running tests
- Change hash algorithm without extensive testing
- Add dependencies without good reason (keep it tiny)
- Use `rm -rf` in code (use `rmSync` with proper paths)

## Changesets

When making changes that affect the published package:

1. Run `pnpm changeset`
2. Select `tix` package
3. Choose version bump type:
   - `patch`: Bug fixes, internal changes
   - `minor`: New features (backwards compatible)
   - `major`: Breaking changes
4. Write a clear description for release notes

## References

- [Nix PhD Thesis](https://nixos.org/~eelco/pubs/phd-thesis.pdf) — The foundational document
- [Nix Pills](https://nixos.org/guides/nix-pills/) — Practical walkthrough
- [Store Path Spec](https://github.com/NixOS/nix/blob/master/doc/manual/source/protocols/store-path.md)
- `docs/RESEARCH.md` — Our notes on Nix internals

## Getting Help

- Check existing tests for examples
- Read `docs/RESEARCH.md` for Nix algorithm details
- Open an issue for questions
