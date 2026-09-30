import { isTauri } from "./api";

/**
 * Save a text file.
 * - In Tauri (desktop): native Save dialog + fs write (works in WebView2,
 *   where `<a download>` with a blob URL silently does nothing).
 * - In browser: anchor download. The anchor MUST be in the DOM and the
 *   object URL revoked only after the download started — revoking
 *   synchronously after click() cancels the download in Chrome/Firefox.
 */
export async function downloadTextFile(filename: string, text: string, mime: string): Promise<void> {
  if (isTauri()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({ defaultPath: filename });
      if (!path) return; // user cancelled
      await writeTextFile(path, text);
      return;
    } catch (e) {
      // Plugin missing or save failed — fall through to anchor fallback.
      console.warn("Tauri save failed, falling back to anchor download", e);
    }
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Must be attached for Firefox / WebView; hidden so no layout shift.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Revoke after the browser has picked up the download.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

/** Escape one CSV field (columns and values share the same rule). */
export function csvEscape(v: unknown): string {
  let s: string;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  } else {
    s = String(v);
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text with BOM so Excel opens UTF-8 correctly. */
export function buildCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  return "﻿" + lines.join("\r\n");
}
