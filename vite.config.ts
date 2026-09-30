import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Single source of truth for the app version: package.json.
// Injected as __APP_VERSION__ (see src/vite-env.d.ts) so the UI, the
// Tauri config and Cargo.toml can never drift apart — scripts/sync-version.mjs
// propagates the same value to the native side on every build.
const pkgVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version ?? "0.0.0";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust build output locks files on Windows; watching it crashes Vite (EBUSY).
      ignored: ["**/src-tauri/target/**", "**/src-tauri/gen/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
