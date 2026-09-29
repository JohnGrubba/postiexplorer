/**
 * Release build helper.
 *
 *   npm run dist                build for the current OS, collect bundles into ./releases/
 *   npm run dist -- --bundles nsis|appimage|dmg ...
 *
 * Why not `./dist`? That folder is Vite's frontend output (and Tauri's
 * `frontendDist`). Overwriting it would break `tauri build`. All finished
 * installers / portable binaries are copied to top-level `./releases/`
 * instead, preserving per-OS subfolders:
 *
 *   releases/windows/*.exe *.msi
 *   releases/linux/*.AppImage *.deb *.rpm
 *   releases/macos/*.dmg *.app.tar.gz
 *   releases/portable/postiexplorer*   (raw single-file binary)
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "releases");
const BUNDLE = join(ROOT, "src-tauri", "target", "release", "bundle");

const extraArgs = process.argv.slice(2); // forwarded to `tauri build`

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  // No shell: avoids DEP0190 and quoting issues. The Tauri CLI ships with
  // devDependencies, so call the local binary directly.
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function collect(dir, destSub) {
  const src = join(BUNDLE, dir);
  if (!existsSync(src)) return 0;
  const dest = join(OUT, destSub);
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    const p = join(src, f);
    if (statSync(p).isFile()) {
      cpSync(p, join(dest, f));
      console.log(`  collected ${dir}/${f}`);
      n++;
    }
  }
  return n;
}

// 1. Full Tauri release build (runs `npm run build` for the frontend first).
import { existsSync as _exists } from "node:fs";
const tauriBin = join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);
const fallback = process.platform === "win32" ? "npx.cmd" : "npx";
run(_exists(tauriBin) ? tauriBin : fallback, _exists(tauriBin) ? ["build", ...extraArgs] : ["tauri", "build", ...extraArgs]);

// 2. Copy bundles to ./releases/.
mkdirSync(OUT, { recursive: true });
let n = 0;
n += collect("nsis", "windows");
n += collect("msi", "windows");
n += collect("appimage", "linux");
n += collect("deb", "linux");
n += collect("rpm", "linux");
n += collect("dmg", "macos");

// Raw portable binary (single file, no installer).
const binName = process.platform === "win32" ? "postiexplorer.exe" : "postiexplorer";
const binSrc = join(ROOT, "src-tauri", "target", "release", binName);
if (existsSync(binSrc)) {
  const dest = join(OUT, "portable");
  mkdirSync(dest, { recursive: true });
  cpSync(binSrc, join(dest, binName));
  console.log(`  collected portable/${binName}`);
  n++;
}

if (n === 0) {
  console.error("No bundles found under src-tauri/target/release/bundle/");
  process.exit(1);
}
console.log(`\nDone: ${n} file(s) in ./releases/`);
