# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

Pre-1.0 releases move fast; only the latest `v0.1.x` receives fixes.

## Reporting a vulnerability

Open a **private security advisory** on GitHub
(`Security` → `Report a vulnerability`) or email the maintainer directly.
Please include:

- What you connected to (local Postgres, managed host, …) — never real credentials
- The exact error text / logs and steps to reproduce
- The app version and OS (`PostiExplorer_0.1.0_…`, Windows/Linux/macOS)

You will get a first response within 7 days. If confirmed, a fix and a
release will follow, and you will be credited unless you prefer otherwise.

## Scope notes

- Connection profiles (including passwords) are stored in plain `localStorage`
  in v0.1. Secret-store integration (OS keychain) is on the roadmap — treat
  saved passwords accordingly and do not file this as a vulnerability.
- The v0.1 backend connects with `NoTls`; servers that require SSL will fail
  to connect rather than downgrade silently.
