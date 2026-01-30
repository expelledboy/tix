# tix

> A tiny, TypeScript reimagining of Nix.

Tix brings Nix's core ideas—content-addressed storage, reproducible builds, and declarative package management—to TypeScript, without the custom DSL.

## Why?

Nix is powerful but has a steep learning curve. Its custom language, complex tooling, and historical baggage make it hard to adopt. Tix asks: **what if we kept the good parts and used TypeScript?**

## Core Ideas

Same as Nix:
- **Content-addressed store**: `/tix/store/<hash>-<name>`
- **Input-addressed derivations**: Same inputs → same hash → same output
- **Sandboxed builds**: No network, no `/usr`, only explicit inputs
- **Atomic installs**: Build in temp, move atomically

Different from Nix:
- **TypeScript is the config language** (no Nix expression language)
- **JSON `.drv` files** (not ATerm)
- **Docker for sandboxing** (not custom namespaces)
- **Simpler mental model** (no daemon, no profiles yet)

## Quick Start

```ts
import { sh, drv, build } from 'tix';

// Shell-based derivation
const hello = sh`
  mkdir -p $out/bin
  echo '#!/bin/sh' > $out/bin/hello
  echo 'echo "Hello from Tix!"' >> $out/bin/hello
  chmod +x $out/bin/hello
`;

// Build it
const outPath = await build(hello);
console.log(outPath); // /tix/store/abc123-hello
```

## Explicit Derivations

```ts
const myPackage = drv({
  name: "my-package",
  builder: "/bin/sh",
  args: ["-c", "mkdir -p $out && echo 'built!' > $out/result"],
  env: { FOO: "bar" },
  inputs: [someDependency],
  src: "./src",
});
```

## Fixed-Output Derivations (Fetchers)

```ts
const tarball = fetchUrl({
  name: "source.tar.gz",
  url: "https://example.com/source.tar.gz",
  sha256: "abc123...",
});
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  your-config.ts  (TypeScript = config language)     │
└─────────────────────────────────────────────────────┘
                    │
                    ▼ evaluate
┌─────────────────────────────────────────────────────┐
│  instantiate(): Derivation → DrvFile → store        │
│  • Compute hashes recursively (bottom-up)           │
│  • Write .drv.json files to store                   │
└─────────────────────────────────────────────────────┘
                    │
                    ▼ realize
┌─────────────────────────────────────────────────────┐
│  realize(): Build in sandbox (Docker)               │
│  • Topo-sort dependencies                           │
│  • Skip if output exists                            │
│  • Isolated env: PATH=/path-not-set                 │
│  • Atomic: build in /tmp, move to store             │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│  /tix/store/<hash>-<name>/...  (immutable)          │
└─────────────────────────────────────────────────────┘
```

## The Hash Algorithm

The core insight from Nix: **the hash of a derivation includes the hashes of all its inputs, recursively**.

```typescript
function hashDerivationModulo(drv: Derivation): Hash {
  // Fixed-output: hash based on OUTPUT content, not inputs
  if (drv.outputHash) {
    return sha256(`fixed:out:sha256:${drv.outputHash}:`);
  }
  
  // Regular: hash based on ALL inputs
  return sha256({
    name: drv.name,
    builder: drv.builder,
    args: drv.args,
    env: drv.env,
    // RECURSIVE: hash of each input's hash!
    inputs: drv.inputs.map(hashDerivationModulo),
    outputs: { out: "" }, // Empty for hashing (chicken-egg)
  });
}
```

This means:
- Change any input → different hash → different output path → can coexist
- Fixed-output derivations are identified by their content, not their build recipe

## Store Path Format

Following Nix's algorithm:
```
storePath = storeDir + "/" + nix32(sha256(fingerprint)[0:20]) + "-" + name

fingerprint = "output:out:sha256:" + drvHash + ":" + storeDir + ":" + name
```

## CLI

```bash
tix build ./hello.ts          # Build default export
tix build ./hello.ts myExport # Build named export
tix show ./hello.ts           # Show derivation JSON
tix path ./hello.ts           # Print output path (without building)
```

## Status

🚧 **Work in Progress**

- [x] Core types and hashing
- [x] Store implementation
- [x] Derivation instantiation
- [ ] Docker sandbox builds
- [ ] Fixed-output derivations (network fetches)
- [ ] Binary caching
- [ ] Garbage collection

## References

- [Eelco Dolstra's PhD Thesis](https://nixos.org/~eelco/pubs/phd-thesis.pdf) — The foundational document
- [Nix Pills](https://nixos.org/guides/nix-pills/) — Practical walkthrough
- [Nix Manual - Derivations](https://nix.dev/manual/nix/2.28/language/derivations)
- [Store Path Spec](https://github.com/NixOS/nix/blob/master/doc/manual/source/protocols/store-path.md)

## License

MIT
