# AGENTS.md — PostiExplorer

Tauri v2 (Rust) + React + TS + Tailwind. Single-binary PostgreSQL explorer. Node >=18, Rust >=1.77.

## Architecture (where code goes)

- All SQL in `src-tauri/src/db.rs`. `src-tauri/src/main.rs` commands are thin wrappers. New backend feature = function in `db.rs` + `#[tauri::command]` in `main.rs` + call in `src/lib/api.ts`.
- `src/types.ts` mirrors `src-tauri/src/models.rs`. Change both.
- `src/lib/api.ts` must keep browser fallback: `isTauri()` checks **both** `__TAURI__` and `__TAURI_INTERNALS__`; non-Tauri path uses `src/lib/mock.ts`. Never break `npm run dev`.
- Empty `profile.database` means "connect to `postgres` maintenance DB, then pick" (`effectiveProfile` in `api.ts`). Preserve this.
- Row edits are ctid-addressed (work without PKs); views/matviews are read-only (`editable: false`). Stale ctid fails after UPDATE — expected.

## Critical order: build frontend before Rust

Tauri embeds `../dist` at compile time (`generate_context!`). Any `cargo test` / `cargo check` / `tauri dev|build` without `dist/` fails with `frontendDist ... but this path doesn't exist`.

```bash
npm install
docker compose up -d   # postgres:16, seeds demo_db from seed.sql
npm run dev            # browser preview, mock data, http://127.0.0.1:1420
npm run tauri dev      # desktop window, real Rust backend
```

Verification (mandatory, in order — always test against live DB, mock-only is not enough):

```bash
npx tsc --noEmit
npm run build  # required before any cargo command (embeds ../dist)
docker compose up -d   # postgres:16 on 5432, password `postgres`
npm run test:db        # = build + cargo test --test live_db; needs the compose DB
```

Live-DB suite is `src-tauri/tests/live_db.rs` (connect, picker flow, error SQLSTATEs, browse, ctid CRUD, privileges, DDL). Env overrides: `PG_HOST PG_PORT PG_USER PG_PASSWORD PG_DB` (defaults `localhost 5432 postgres postgres demo_db`).
`docker-compose.yml` mounts `./seed.sql` to `/docker-entrypoint-initdb.d/` — applied only on first start (volume `pgdata` persists). Reseed with `docker compose down -v && docker compose up -d`. Seed creates `demo_db` with `public.users/orders/products`, view `public.order_summary`, plus `auth.sessions` and `billing.invoices`; tests assert these names.

## Gotchas

- `vite.config.ts`: `strictPort: true` on 1420; watches `src-tauri/target/**` ignored (Windows EBUSY). `__TAURI__ undefined` in browser is expected.
- Version single source: `package.json`. `prebuild`/`predist`/`tauri` hooks run `scripts/sync-version.mjs` to propagate to `tauri.conf.json` + `Cargo.toml`. Never hand-edit those versions; check with `npm run version:check`. Bundle filenames are versionless on purpose (`scripts/build-release.mjs`); `KEEP_VERSIONED_NAMES=1` keeps them.
- TLS: backend always uses `NoTls` (`TLS TODO` in `db.rs`). `sslmode=require` is accepted/validated but not actually encrypted — don't claim otherwise.
- Layout: `h-screen` flex with internal scroll; verify at 1280×800 and 960px min width, no horizontal overflow.
- Errors must include SQLSTATE detail (e.g. `28P01`, `3D000`), never bare `db error`.
- README.md must be updated with every change/feature: move items between `✅ Implemented` / `❌ roadmap` tables, update Architecture / Project layout sections if files change, add screenshots for UI changes. Never hand-edit versioned asset names — `sync-version.mjs` owns them.
- TS `strict`, Rust `cargo fmt` clean. Commits: short imperative scoped (`fix: …`, `feat: …`).
- CI (`.github/workflows/build.yml`): path-filtered (src/src-tauri/scripts/config only); Linux job runs live-DB tests then `npm run dist -- --bundles appimage deb` (no rpm); rolling `latest` release on every push to `main`, no manual tags.
