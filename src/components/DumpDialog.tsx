import { useEffect, useMemo, useState } from "react";
import { DatabaseBackup, Download, FolderOpen, RefreshCw } from "lucide-react";
import { listSchemas, listTables } from "../lib/api";
import { downloadTextFile } from "../lib/download";
import { exportDump, restoreDump } from "../lib/dump";
import { splitBatch } from "../lib/sqlsplit";
import type { SchemaEntry, TableEntry } from "../types";

interface Props {
  database: string;
  onClose: () => void;
  onRestored: () => void;
}

export default function DumpDialog({ database, onClose, onRestored }: Props) {
  const [mode, setMode] = useState<"export" | "restore">("export");
  const [schemas, setSchemas] = useState<SchemaEntry[]>([]);
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, TableEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeSchema, setIncludeSchema] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore state
  const [fileName, setFileName] = useState<string | null>(null);
  const [sqlText, setSqlText] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const s = await listSchemas();
        setSchemas(s);
        const map: Record<string, TableEntry[]> = {};
        const sel = new Set<string>();
        for (const entry of s) {
          if (!entry.can_usage) {
            map[entry.name] = [];
            continue;
          }
          const tables = await listTables(entry.name).catch(() => []);
          map[entry.name] = tables;
          for (const t of tables) {
            if (t.can_select) sel.add(`${t.schema}.${t.name}`);
          }
        }
        setTablesBySchema(map);
        setSelected(sel);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const targets = useMemo(() => {
    const out: { schema: string; table: string; kind: string }[] = [];
    for (const list of Object.values(tablesBySchema)) {
      for (const t of list) {
        if (selected.has(`${t.schema}.${t.name}`)) out.push({ schema: t.schema, table: t.name, kind: t.kind });
      }
    }
    return out;
  }, [tablesBySchema, selected]);

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  async function doExport() {
    if (busy || targets.length === 0 || (!includeSchema && !includeData)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await exportDump({
        database,
        targets,
        includeSchema,
        includeData,
        onProgress: (p) => setProgress(p),
      });
      setProgress(null);
      await downloadTextFile(`${database}_dump.sql`, res.sql, "text/sql;charset=utf-8");
      setResult(`Exported ${res.tableCount} objects · ${res.rowCount.toLocaleString()} rows · ${res.statementCount} statements → ${database}_dump.sql`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setError(null);
    setResult(null);
    try {
      setSqlText(await f.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const stmtCount = useMemo(() => {
    if (!sqlText.trim()) return 0;
    try {
      return splitBatch(sqlText).length;
    } catch {
      return 0;
    }
  }, [sqlText]);

  async function doRestore() {
    if (busy || !sqlText.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await restoreDump(sqlText, (done, total) => setProgress(`Executing ${done}/${total} statements…`));
      setProgress(null);
      setResult(`Restored ${res.statements} statements in ${res.batches} batches · ${res.executionMs} ms`);
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  const tab = (id: "export" | "restore", label: string) => (
    <button
      key={id}
      onClick={() => !busy && setMode(id)}
      className={`h-8 rounded-lg px-3 text-[13px] font-medium ${mode === id ? "bg-neon/20 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <DatabaseBackup size={16} className="text-neon" />
          <div className="text-sm font-bold text-white">Database dump — {database}</div>
          <div className="flex-1" />
          {tab("export", "Export")}
          {tab("restore", "Restore")}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {mode === "export" && (
            <>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={includeSchema} onChange={(e) => setIncludeSchema(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
                  Schema (DDL)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={includeData} onChange={(e) => setIncludeData(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
                  Data (INSERTs)
                </label>
                <div className="flex-1" />
                <span className="font-mono text-slate-500">{targets.length} objects selected</span>
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <RefreshCw size={13} className="animate-spin" /> Loading objects…
                </div>
              ) : (
                <div className="space-y-2">
                  {schemas.map((s) => (
                    <div key={s.name} className="overflow-hidden rounded-xl border border-edge">
                      <div className="bg-panel2 px-2.5 py-1.5 font-mono text-xs text-slate-200">{s.name}</div>
                      {(tablesBySchema[s.name] ?? []).map((t) => {
                        const key = `${t.schema}.${t.name}`;
                        return (
                          <label key={key} className="flex items-center gap-2 border-t border-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/[0.03]">
                            <input type="checkbox" checked={selected.has(key)} disabled={!t.can_select} onChange={() => toggle(key)} className="h-3.5 w-3.5 accent-cyan-400" />
                            <span className="font-mono">{t.name}</span>
                            <span className="rounded bg-white/5 px-1 font-mono text-[10px] text-slate-500">{t.kind}</span>
                            {!t.can_select && <span className="text-[10px] text-slate-600">no SELECT</span>}
                          </label>
                        );
                      })}
                      {(tablesBySchema[s.name] ?? []).length === 0 && (
                        <div className="border-t border-white/[0.04] px-2.5 py-1.5 text-[11px] text-slate-600">No accessible tables</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === "restore" && (
            <>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-edge bg-white/[0.03] px-3 py-3 text-[13px] text-slate-300 hover:bg-white/[0.06]">
                <FolderOpen size={15} className="shrink-0 text-neon" />
                <span className="truncate">{fileName ?? "Choose a .sql dump file…"}</span>
                <input type="file" accept=".sql,.txt,text/sql" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
              </label>
              <textarea
                value={sqlText}
                onChange={(e) => setSqlText(e.target.value)}
                spellCheck={false}
                placeholder="…or paste SQL here"
                className="h-32 w-full resize-y rounded-xl border border-edge bg-void p-2.5 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600"
              />
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                Dumps contain <span className="font-mono">CREATE TABLE</span> — restore fails if objects already exist. Drop them first or edit the file. Statements run in order
                ({stmtCount} found, ≤100 per batch).
              </div>
            </>
          )}

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">{error}</div>}
          {progress && <div className="text-xs text-neon">{progress}</div>}
          {result && <div className="rounded-xl border border-neon/30 bg-neon/10 px-3 py-2 text-xs text-neon">{result}</div>}
        </div>

        <div className="flex gap-2 border-t border-edge p-3">
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Close
          </button>
          {mode === "export" ? (
            <button
              onClick={() => void doExport()}
              disabled={busy || loading || targets.length === 0 || (!includeSchema && !includeData)}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
            >
              <Download size={14} /> {busy ? "Exporting…" : `Export ${targets.length} objects`}
            </button>
          ) : (
            <button
              onClick={() => void doRestore()}
              disabled={busy || !sqlText.trim()}
              className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
            >
              {busy ? "Restoring…" : `Restore ${stmtCount} statements`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
