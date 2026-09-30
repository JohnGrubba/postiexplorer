/**
 * Single source of truth for the app version: the `version` field in
 * package.json. Everything else follows it:
 *
 *   package.json ──reads──> src-tauri/tauri.conf.json  (`version`)
 *                └─reads──> src-tauri/Cargo.toml       (`[package] version`)
 *
 * The frontend gets the same version at build time via `__APP_VERSION__`
 * (see vite.config.ts). Tauri derives installer/bundle file names from
 * productName + version automatically, and cargo refreshes the
 * `postiexplorer` entry in Cargo.lock on the next build by itself.
 *
 * Runs automatically before `npm run build` / `npm run dist` (via the
 * `prebuild` / `predist` hooks) and before `npm run tauri ...`, so cutting
 * a release is just:
 *
 *   npm version 0.1.1     # or edit package.json by hand
 *   npm run dist
 *
 * Use `--check` to only verify that everything is in sync (CI-friendly,
 * exits 1 on drift without writing anything).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(msg) {
  console.error(`sync-version: ERROR: ${msg}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;
if (typeof version !== "string" || !SEMVER.test(version)) {
  fail(`package.json "version" must be semver, got ${JSON.stringify(version)}`);
}

// ── src-tauri/tauri.conf.json (formatting-preserving: only the version string changes) ──
const confPath = join(ROOT, "src-tauri", "tauri.conf.json");
const confRaw = readFileSync(confPath, "utf8");
const confMatch = confRaw.match(/"version"\s*:\s*"([^"]*)"/);
if (!confMatch) fail(`no "version" key found in ${confPath}`);
const confOld = confMatch[1];
const confDrift = confOld !== version;
const confOut = confRaw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`);
try {
  JSON.parse(confOut);
} catch {
  fail(`rewritten ${confPath} is not valid JSON`);
}

// ── src-tauri/Cargo.toml ([package] version only) ──
const cargoPath = join(ROOT, "src-tauri", "Cargo.toml");
const cargoRaw = readFileSync(cargoPath, "utf8");
const lines = cargoRaw.split("\n");
let inPackage = false;
let cargoFound = false;
let cargoDrift = false;
for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed.startsWith("[")) {
    inPackage = trimmed === "[package]";
  } else if (inPackage && /^version\s*=/.test(trimmed)) {
    cargoFound = true;
    const next = lines[i].replace(/"[^"]*"/, `"${version}"`);
    if (next !== lines[i]) {
      lines[i] = next;
      cargoDrift = true;
    }
    break;
  }
}
if (!cargoFound) fail("no `version = ...` found under [package] in src-tauri/Cargo.toml");
const cargoOut = lines.join("\n");

if (CHECK) {
  const problems = [];
  if (confDrift) problems.push(`tauri.conf.json is ${JSON.stringify(confOld)}`);
  if (cargoDrift) problems.push("Cargo.toml [package] version differs");
  if (problems.length > 0) {
    fail(`version drift detected (package.json says ${version}):\n  - ${problems.join("\n  - ")}\nRun \`npm run sync-version\` to fix.`);
  }
  console.log(`sync-version: OK — everything is at ${version}`);
  process.exit(0);
}

const touched = [];
if (confOut !== confRaw) {
  writeFileSync(confPath, confOut);
  touched.push("src-tauri/tauri.conf.json");
}
if (cargoOut !== cargoRaw) {
  writeFileSync(cargoPath, cargoOut);
  touched.push("src-tauri/Cargo.toml");
}
console.log(
  touched.length > 0
    ? `sync-version: ${version} (updated ${touched.join(", ")})`
    : `sync-version: ${version} (already in sync)`,
);
