# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-01-31

### Added

- Initial release
- Core content-addressed store implementation
- Derivation hashing (hashDerivationModulo algorithm)
- Store path computation matching Nix format
- Nix32 encoding (base32 without e/o/u/t)
- Derivation instantiation (Derivation → DrvFile → store)
- Topological sorting with cycle detection
- Docker-based sandboxed builds
- User API: `sh`, `drv`, `fetchUrl`, `env`
- CLI: `tix build`, `tix show`, `tix path`
- Fixed-output derivation support
- Comprehensive test suite (111 tests)

### Architecture

- TypeScript as configuration language (no custom DSL)
- JSON format for .drv files (not ATerm)
- Branded types for type safety (StorePath, DrvPath, Hash)
- Atomic writes with temp file + rename

[Unreleased]: https://github.com/expelledboy/tix/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/expelledboy/tix/releases/tag/v0.1.0
