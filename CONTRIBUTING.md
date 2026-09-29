# Contributing to PostiExplorer

Thanks for considering a contribution. This project aims for a small, clean
core: every feature should work against a real PostgreSQL and stay shippable
as a single binary.

## Ground rules

- **Base first:** bug fixes and small, well-scoped features beat big rewrites.
- **Real-DB verified:** backend changes must pass `cargo test --test live_db`
  (see below). Frontend changes should include a screenshot in the PR.
- **No overflows:** the layout is `h-screen` flex with internal scroll areas.
  Check your change at 1280×800 and at the 960px minimum width.
- Follow the existing code style (TypeScript strict, Rust `cargo fmt` clean).

## Development setup

```bash
npm install
docker compose up -d   # local postgres:16, seeds demo_db from seed.sql
npm run dev            # browser preview (mock data, no backend)
npm run tauri dev      # desktop window with the real Rust backend
```

## Checks before opening a PR

```bash
npx tsc --noEmit
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --test live_db --manifest-path src-tauri/Cargo.toml
```

> Order matters: `cargo test`/`cargo check` compile the Tauri binary, which
> embeds `../dist` at compile time (`generate_context!`). Always run
> `npm run build` first, or you get
> `frontendDist ... but this path doesn't exist`. `npm run test:db` does
> this for you.

## Architecture (where things go)

- All SQL lives in `src-tauri/src/db.rs`. Tauri commands in
  `src-tauri/src/main.rs` are thin wrappers — a new backend feature is a new
  function in `db.rs` + a `#[tauri::command]` + a call in `src/lib/api.ts`.
- `src/lib/api.ts` must keep working in plain browsers (mock fallback in
  `src/lib/mock.ts`). Never break `npm run dev`.
- Shared shapes: `src/types.ts` mirrors `src-tauri/src/models.rs`. Change both.

## Commit messages

Short, imperative, scoped: `fix: show SQLSTATE in auth errors`,
`feat: database picker in sidebar`, `docs: release checklist`.

## Reporting issues

Use the bug / feature templates. Include the header subtitle
(`desktop · live backend` vs `web preview · mock data`), the exact error
text, and your PostgreSQL version. For connection problems, also note whether
your server requires SSL (v0.1 connects with `NoTls` — see `TLS TODO`).
