# BUILD — PostiExplorer to a standalone executable

PostiExplorer uses **Tauri v2**: the React frontend is baked into a Rust binary.
Result is a single portable executable per OS (plus optional installers).

## 1. Prerequisites

| OS | Install |
|----|---------|
| Windows | WebView2 (preinstalled on Win10/11), VS Build Tools 2022 with C++ workload, Rust stable, Node 18+ |
| Linux | `build-essential`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, Rust, Node |
| macOS | Xcode CLT (`xcode-select --install`), Rust, Node |

Check with:

```bash
npx tauri info
```

All lines under Environment should be ✔ (see verified output in README).

Rust toolchain used for v0.1: **1.98.1 stable-x86_64-pc-windows-msvc**.
If your `rustc` is older than 1.77, run `rustup update`.

## 2. Install + dev

```bash
npm install
npm run dev              # browser preview, mock data, http://127.0.0.1:1420
npm run tauri dev        # real desktop window with Rust backend
```

`npm run dev` uses `src/lib/mock.ts` (no database needed).
`npm run tauri dev` calls the real Postgres backend in `src-tauri/src/db.rs`.

## 3. Build (release, single binary)

```bash
npm run build            # sanity: frontend must compile first
npm run tauri build
npm run dist             # same build + collect installers into top-level ./releases/
# or: npm run dist -- --bundles nsis        # Windows, installer only
#     npm run dist -- --bundles appimage    # Linux, single-file AppImage
#     npm run dist -- --bundles dmg         # macOS
```

`tauri.conf.json` sets `"targets": "all"` — one invocation builds every
bundle for the **current** OS. Cross-compiling (e.g. Windows → macOS binary)
is not supported; build on each OS (or CI, see §5).

## 4. Where the binaries land

`npm run dist` copies the finished artifacts into top-level `./releases/`
(gitignored — CI publishes them as a GitHub Release instead):

```
releases/
  windows/PostiExplorer_<version>_x64-setup.exe   ← installer (single .exe)
  windows/*.msi
  linux/*.AppImage                             ← single file, chmod +x to run
  linux/*.deb  linux/*.rpm
  macos/*.dmg
  portable/postiexplorer(.exe)                 ← raw single-file binary
```

The `<version>` in installer names comes from `package.json` — see §8.

Raw Tauri output stays under `src-tauri/target/release/` (`postiexplorer(.exe)`)
and `.../bundle/` — `releases/` is just the collected, shippable copy.

- **Windows portable**: `target/release/postiexplorer.exe` runs as-is on
  Win10/11 (WebView2 runtime required — preinstalled on stock Windows).
  Distribute the NSIS `-setup.exe` if you want an installer.
- **Linux portable**: the `.AppImage` is the single-file equivalent —
  `chmod +x *.AppImage && ./PostiExplorer*.AppImage`.
- **macOS**: distribute the `.dmg`.

Bundle metadata (name, identifier, icons, category) lives in
`src-tauri/tauri.conf.json` + `src-tauri/icons/`.

## 5. CI (build all three OSes)

`.github/workflows/build.yml` builds Windows (x64), Linux (x64) and macOS
(arm64) on every push/PR. The Linux job additionally seeds a real
`postgres:16` service with `seed.sql` and runs `cargo test --test live_db`
before building. Every push to `main` updates the rolling `latest`
GitHub Release with everything in `releases/` (artifacts are also kept per run).
No manual tags needed.

```yaml
# sketch of the matrix
strategy: # (see file for full definition)
# windows-latest → npm run dist -- --bundles nsis
# ubuntu-22.04   → live-DB tests + npm run dist
# macos-latest   → npm run dist -- --bundles dmg
```

## 6. Troubleshooting

- `cargo check` fails on old Rust → `rustup update`.
- Windows link errors → install VS Build Tools C++ workload, reboot.
- Linux `webkit2gtk not found` → install the dev packages from §1.
- Blank window in `tauri dev` → ensure `npm run dev` serves on port 1420
  (`vite.config.ts` sets `strictPort: true`).
- `__TAURI__ undefined` in browser → expected; the app falls back to mock data.
  Real Postgres only works inside the Tauri window.
- `frontendDist "..." but this path doesn't exist` → the frontend was never
  built. Run `npm run build` first — `cargo test`/`cargo check` also compile
  the Tauri binary, which embeds `dist/` at compile time.
- Linux `rpm` bundle fails (`rpmbuild` missing) → build
  `--bundles appimage deb` (the CI default) instead of `all`.

## 7. Current verification (v0.1, 2026-09-29)

- `npx tsc --noEmit` → exit 0
- `npm run build` → `dist/` in ~3s, 190 kB JS (58 kB gzip)
- `cargo check` (src-tauri) → ok, zero warnings
- `npx tauri info` → all ✔ (WebView2 154, MSVC 2022, rustc 1.98.1)
- `npx tauri build --bundles nsis` → exit 0, release profile in ~1m42s:
  - `src-tauri/target/release/postiexplorer.exe` (12.8 MB, portable single file)
  - `src-tauri/target/release/bundle/nsis/PostiExplorer_0.1.0_x64-setup.exe` (2.9 MB installer)
- Screenshots in `screenshots/` (7 states) + `scrollWidth == clientWidth` (no horizontal overflow)
- Live-DB path: backend compiles; point a profile at your Postgres and press
  **Test connection** (mock data is used in browser preview only).

## 8. Versioning (single source of truth)

`package.json` → `"version"` decides everything. To cut e.g. **V0.1.1**:

```bash
npm version 0.1.1     # bumps package.json (+ lockfile) and tags the commit
npm run dist          # everything below follows automatically
```

(or just edit the `version` field in `package.json` by hand).

What follows automatically on every `npm run build` / `npm run dist` /
`npm run tauri ...` (via `prebuild` / `predist` hooks →
`scripts/sync-version.mjs`):

| Artifact | Source after sync |
|---|---|
| `src-tauri/tauri.conf.json` → `version` | = package.json |
| `src-tauri/Cargo.toml` → `[package] version` | = package.json |
| Installer/bundle file names (`PostiExplorer_<version>_…`) | derived by Tauri |
| Header + status bar in the app UI | baked in at build time (`__APP_VERSION__`, see `vite.config.ts`) |
| `src-tauri/Cargo.lock` (`postiexplorer` entry) | refreshed by cargo itself on the next build |

Check drift without writing anything: `npm run version:check`
(exits 1 when the files disagree — e.g. after a hand-edit).
