/**
 * Stable (versionless) artifact names.
 *
 * Tauri embeds the package version in bundle file names
 * (e.g. `PostiExplorer_0.1.1_x64-setup.exe`), which breaks direct
 * `releases/latest/download/<file>` links on every version bump.
 * `scripts/build-release.mjs` strips the version when collecting bundles
 * into `./releases/` so download URLs stay permanent:
 *
 *   PostiExplorer_0.1.1_x64-setup.exe  →  PostiExplorer_x64-setup.exe
 *   PostiExplorer_0.1.1_amd64.AppImage →  PostiExplorer_amd64.AppImage
 *
 * The version itself stays in tauri.conf.json / Cargo.toml (required for
 * installer upgrade detection) and is shown inside the app — only the
 * file name drops it. The arch token stays so per-OS/per-arch assets
 * never collide in the flat GitHub Release namespace.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? "";
  } catch {
    return "";
  }
})();

export function stableName(filename, version = APP_VERSION) {
  if (!version) return filename;
  return filename.split(`_${version}`).join("").split(`-${version}`).join("");
}
