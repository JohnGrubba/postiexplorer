# PostiExplorer — Modern PostgreSQL Explorer

Single-binary desktop app for PostgreSQL. Tauri v2 (Rust) + React + TypeScript + Tailwind.

Modern Web3-like dark UI, no overflows, responsive flex layout with internal scroll areas.

![connected](screenshots/app-02-connected.png)
![query](screenshots/app-03-query.png)

## Base functionality (v0.1)

- Connection profiles (host, port, user, **optional database**, sslmode), saved to localStorage, test-connection
- Database picker: leave the database empty to connect via the `postgres` maintenance DB, then switch between all databases from the sidebar — no reconnect dialog needed
- Schema / table / view explorer with search + refresh
- Table data grid: pagination (25–250/page), server-side LIMIT/OFFSET, click-to-sort, total count, execution time
- Table structure: columns, types, nullable, defaults, PK badges
- SQL editor: run with Ctrl+Enter, results grid, history (20), CSV export, timing + row count
- Server info cards: version, size, tables, connections, uptime
- Status bar: live/offline, selection, latency

All PostgreSQL access goes through `src-tauri/src/db.rs`. Every Tauri command in
`src-tauri/src/main.rs` is a thin wrapper — new features only need a new function
in `db.rs` + a new `#[tauri::command]` + a frontend call in `src/lib/api.ts`.

Stubbed for next milestones (UI placeholders + backend extension points already in place):
functions, triggers, extensions, roles, EXPLAIN ANALYZE, multi-statement batches,
ER diagram, import/export, TLS (`sslmode=require` — see `TLS TODO` in `db.rs`).

## Quick start

```bash
npm install
npm run dev        # web preview with mock data (no database needed)
```

Open http://127.0.0.1:1420 — click **Connect** to browse mock data.

For a live database, run inside the Tauri window (or `npm run tauri dev`):

```bash
npm run tauri dev
```

## Build standalone executables

See [BUILD.md](BUILD.md) — one command per OS:

```bash
npm run tauri build        # current OS (bundles in src-tauri/target/...)
npm run dist               # build + collect finished installers into ./releases/
```

`./releases/` (gitignored) collects everything per OS — see `scripts/build-release.mjs`.
`./dist/` is **not** used for installers: it is Vite's frontend output and
Tauri's `frontendDist`. Overwriting it would break the build.

Outputs: Windows `.exe` + NSIS installer, Linux `.AppImage`/`.deb`, macOS `.dmg`/`.app`.

## Project layout

```
src/                  React frontend
  components/         Header, Sidebar, DataGrid, TableDataView, StructureView,
                      QueryView, InfoView, ConnectionDialog, StatusBar
  lib/api.ts          Tauri invoke wrapper + browser mock fallback
  lib/mock.ts         Demo dataset (used when __TAURI__ is absent)
  lib/profiles.ts     localStorage persistence
  types.ts            Shared TS types (mirror of Rust models.rs)
src-tauri/
  src/main.rs         Tauri commands (thin wrappers)
  src/db.rs           All SQL + connection pool (Arc<Mutex<Client>>)
  src/models.rs       Serde structs
  tauri.conf.json     Window + bundle config
  capabilities/       Permissions
screenshots/          Verified UI states
```

## Testing

- `npx tsc --noEmit` — typecheck ✅
- `npm run build` — production frontend build ✅
- `cargo test --test live_db` in `src-tauri` — Rust backend vs **real PostgreSQL 16** ✅
- Playwright screenshots + overflow check (`scrollWidth == clientWidth`) ✅
- Live-DB test: point a profile at your Postgres and use Test / Connect.

### Local Postgres (Docker)

```bash
docker compose up -d   # postgres:16 on localhost:5432, seeds demo_db from seed.sql
npm run test:db        # runs the live-DB integration tests
```

`src-tauri/tests/live_db.rs` covers connect, wrong-password / wrong-database
errors, databases → schemas → tables → columns → paged/sorted rows → raw SQL →
server info. CI runs the same suite on every push (Linux job, see below).

## License

MIT — do what you want, no warranty.
