# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Tix, please report it by opening a **private security advisory** on GitHub rather than a public issue.

Go to: https://github.com/expelledboy/tix/security/advisories/new

**What to include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and work with you to understand and address the issue.

## Security Considerations

Tix executes builds in Docker containers with:
- Network isolation (by default)
- No access to host filesystem (except mounted paths)
- Read-only store mounts

However, be aware:
- **Fixed-output derivations** can access the network (by design)
- **The builder has root in the container** — avoid building untrusted derivations
- **Store paths are world-readable** — don't build secrets into outputs

## Best Practices

1. **Pin your inputs** — Use content hashes for fetched files
2. **Review derivations** — Understand what you're building
3. **Use fixed-output sparingly** — Only for fetching known content
4. **Don't store secrets** — The store is not encrypted
