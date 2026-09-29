<div align="center">
  <img src="src-tauri/icons/icon.png" width="96" alt="PostiExplorer logo" />
  <h1>PostiExplorer</h1>
  <p>Modern single-binary PostgreSQL explorer — Tauri v2 (Rust) + React + TypeScript + Tailwind.</p>
  <p>
    <a href="https://github.com/JohnGrubba/postiexplorer/actions/workflows/build.yml"><img src="https://github.com/JohnGrubba/postiexplorer/actions/workflows/build.yml/badge.svg" alt="build" /></a>
    <a href="https://github.com/JohnGrubba/postiexplorer/blob/main/LICENSE"><img src="https://img.shields.io/github/license/JohnGrubba/postiexplorer" alt="license: MIT" /></a>
    <img src="https://img.shields.io/badge/platform-windows%20%7C%20linux%20%7C%20macos-8b5cf6" alt="platforms" />
    <img src="https://img.shields.io/badge/postgres-16+-22d3ee" alt="postgres 16+" />
  </p>
</div>

## Download

Grab the latest installer from
[**GitHub Releases**](https://github.com/JohnGrubba/postiexplorer/releases):

| OS      | File                                             |
| ------- | ------------------------------------------------ |
| Windows | `PostiExplorer_*_x64-setup.exe` (installer) or `postiexplorer.exe` (portable) |
| Linux   | `*.AppImage` (`chmod +x` to run), `.deb` / `.rpm` |
| macOS   | `*.dmg`                                          |

Releases are built automatically by [CI](.github/workflows/build.yml) on every
`v*` tag. Or build locally — see [BUILD.md](BUILD.md).

## Features (v0.1)

![connected database grid](screenshots/app-02-connected.png)
![database picker](screenshots/app-09-db-picker.png)
![SQL editor](screenshots/app-03-query.png)

- Connection profiles (host, port, user, **optional database**, sslmode) with test-connection
- Database picker: leave the database empty to connect via the `postgres` maintenance DB, then switch between all databases from the sidebar
- Schema / table / view explorer with search + refresh
- Table data grid: pagination (25–250/page), server-side LIMIT/OFFSET, click-to-sort, total count, execution time
- Table structure: columns, types, nullable, defaults, PK badges
- SQL editor: run with Ctrl+Enter, results grid, history (20), CSV export, timing + row count
- Server info cards: version, size, tables, connections, uptime
- Detailed connection errors with SQLSTATE codes (no more bare `db error`)

All PostgreSQL access goes through `src-tauri/src/db.rs`. Every Tauri command in
`src-tauri/src/main.rs` is a thin wrapper — new features only need a new function
in `db.rs` + a new `#[tauri::command]` + a frontend call in `src/lib/api.ts`.

Stubbed for next milestones (UI placeholders + backend extension points already in place):
functions, triggers, extensions, roles, EXPLAIN ANALYZE, multi-statement batches,
ER diagram, import/export, TLS (`sslmode=require` — see `TLS TODO` in `db.rs`).

## Quick start (development)

```bash
npm install
npm run dev        # web preview with mock data (no database needed)
```

Open http://127.0.0.1:1420 — click **Connect** to browse mock data.
The header shows `web preview · mock data` in this mode.

For a live database, run the desktop window:

```bash
docker compose up -d   # local postgres:16, seeds demo_db from seed.sql
npm run tauri dev      # header shows "desktop · live backend"
```

## Project layout

```
src/                  React frontend
  components/         Header, Sidebar, DataGrid, TableDataView, StructureView,
                      QueryView, InfoView, ConnectionDialog, StatusBar
  lib/api.ts          Tauri invoke wrapper + browser mock fallback
  lib/mock.ts         Demo dataset (used when Tauri IPC is absent)
  lib/profiles.ts     localStorage persistence
  types.ts            Shared TS types (mirror of Rust models.rs)
src-tauri/
  src/lib.rs          Library root (re-exports db + models for tests)
  src/main.rs         Tauri commands (thin wrappers)
  src/db.rs           All SQL + connection pool (Arc<Mutex<Client>>)
  src/models.rs       Serde structs
  tests/live_db.rs    Integration tests vs real PostgreSQL
  tauri.conf.json     Window + bundle config
  capabilities/       Permissions
scripts/              build-release.mjs (collects bundles into ./releases/)
screenshots/          Verified UI states
```

## Testing

```bash
npx tsc --noEmit
npm run build
cargo test --test live_db --manifest-path src-tauri/Cargo.toml   # needs docker compose up -d
```

`src-tauri/tests/live_db.rs` covers connect, empty-database picker flow,
wrong-password / wrong-database errors, databases → schemas → tables →
columns → paged/sorted rows → raw SQL → server info. CI runs the same suite
on every push (Linux job).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and small, well-scoped PRs
welcome — please include the header subtitle, exact error text, and (for UI)
a screenshot. By participating you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for supported versions and how to report
vulnerabilities privately.

## License

[MIT](LICENSE) © 2026 Jonas Grubbauer. Built with
[Tauri](https://tauri.app), [tokio-postgres](https://github.com/sfackler/rust-postgres),
React and Tailwind CSS.
