# Contributing to Tix

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/tix.git
cd tix

# Install dependencies (using pnpm)
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Format code
pnpm format
```

### With Nix (recommended)

If you have Nix installed, just run:

```bash
nix develop
```

This gives you Node.js, pnpm, and all dependencies.

## Project Structure

```
src/
├── core/           # Core implementation
│   ├── types.ts    # Type definitions, branded types
│   ├── hash.ts     # SHA256, Nix32, store path computation
│   ├── store.ts    # Content-addressed store
│   ├── derivation.ts # Hash algorithm, instantiation
│   └── build.ts    # Docker sandbox execution
├── api.ts          # User-facing API (sh, drv, fetchUrl, etc.)
├── cli.ts          # CLI entry point
├── index.ts        # Public exports
└── __tests__/      # Tests
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Run specific test file
pnpm test -- hash.test.ts

# Watch mode
pnpm test -- --watch
```

## Code Style

- We use Prettier for formatting
- Run `pnpm format` before committing
- TypeScript strict mode is enabled

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Add tests for any new functionality
3. Ensure all tests pass (`pnpm test`)
4. Update documentation if needed
5. Submit a PR with a clear description

## Architecture Decisions

### Why TypeScript for configuration?

Nix's custom language is powerful but creates a steep learning curve. TypeScript gives us:
- Familiar syntax for most developers
- Full IDE support (autocomplete, type checking)
- Ability to use any npm package in configs
- No need to learn a new language

### Why Docker for sandboxing?

Nix uses custom Linux namespaces, which:
- Only works on Linux
- Requires root or specific capabilities
- Is complex to implement correctly

Docker provides:
- Cross-platform support (Linux, macOS, Windows)
- Well-tested isolation
- Easy to understand and debug

### Why JSON for .drv files?

Nix uses ATerm format, which is:
- Not human-readable
- Requires a custom parser
- Has no tooling support

JSON gives us:
- Human-readable files
- Easy debugging (`cat foo.drv | jq`)
- Standard tooling

## Questions?

Open an issue or start a discussion. We're happy to help!
