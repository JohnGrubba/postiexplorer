import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { importRows } from "../lib/api";
import { mapCsvToColumns, parseCsv } from "../lib/csv";
import { IMPORT_BATCH_SIZE, type ColumnEntry } from "../types";

interface Props {
  schema: string;
  table: string;
  columns: ColumnEntry[];
  onClose: () => void;
  onImported: () => void;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function CsvImportDialog({ schema, table, columns, onClose, onImported }: Props) {
  const [text, setText] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [nullEmpty, setNullEmpty] = useState(true);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return [];
    try {
      return parseCsv(text);
    } catch {
      return [];
    }
  }, [text]);

  const mapped = useMemo(() => {
    if (parsed.length === 0) return { columns: [] as string[], dataRows: [] as string[][], unmatched: [] as string[] };
    return mapCsvToColumns(parsed, columns.map((c) => c.name), hasHeader);
  }, [parsed, columns, hasHeader]);

  const preview = mapped.dataRows.slice(0, 5);
  const canImport = mapped.columns.length > 0 && mapped.dataRows.length > 0 && !importing;

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setError(null);
    try {
      setText(await f.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doImport() {
    if (!canImport) return;
    setImporting(true);
    setError(null);
    try {
      // Empty cells → NULL (default) so NOT NULL / DEFAULT semantics stay
      // predictable; otherwise send the raw string and let PostgreSQL cast
      // the quoted literal (`'123'` → int, `'true'` → bool).
      const payload: unknown[][] = mapped.dataRows.map((r) =>
        r.map((cell) => (nullEmpty && cell === "" ? null : cell)),
      );
      const batches = chunk(payload, IMPORT_BATCH_SIZE);
      let done = 0;
      for (const b of batches) {
        setProgress(`Inserting ${done + 1}–${done + b.length} of ${payload.length}…`);
        await importRows(schema, table, mapped.columns, b);
        done += b.length;
      }
      setProgress(null);
      onImported();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !importing && onClose()}>
      <div className="flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-edge px-4 py-3">
          <div className="text-sm font-bold text-white">Import CSV into {schema}.{table}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {columns.length} target columns · values are inserted as literals (max {IMPORT_BATCH_SIZE} rows per batch)
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-edge bg-white/[0.03] px-3 py-3 text-[13px] text-slate-300 hover:bg-white/[0.06]">
            <Upload size={15} className="shrink-0 text-neon" />
            <span className="truncate">{fileName ?? "Choose a .csv file…"}</span>
            <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={'Paste CSV here, e.g.\nemail,display_name\nada@cardano.io,ada'}
            className="h-28 w-full resize-y rounded-xl border border-edge bg-void p-2.5 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
              First row is header
            </label>
            <label className="flex items-center gap-1.5" title="Send empty cells as NULL so defaults apply">
              <input type="checkbox" checked={nullEmpty} onChange={(e) => setNullEmpty(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
              Empty cells → NULL
            </label>
            <div className="flex-1" />
            <span className="font-mono text-slate-500">
              {mapped.dataRows.length} rows · {mapped.columns.length} mapped columns
            </span>
          </div>

          {mapped.unmatched.length > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              Ignored header columns (no match in {table}): {mapped.unmatched.join(", ")}
            </div>
          )}
          {text.trim() !== "" && mapped.columns.length === 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              No CSV columns match {table} ({columns.map((c) => c.name).join(", ")}). {hasHeader ? "Check the header names or uncheck “First row is header”." : "The file has more columns than the table or is empty."}
            </div>
          )}

          {preview.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-edge">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {mapped.columns.map((c) => (
                      <th key={c} className="border-b border-edge bg-panel2 px-2 py-1.5 text-left font-mono text-slate-200">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b border-white/[0.04]">
                      {r.map((v, j) => (
                        <td key={j} className="max-w-[200px] truncate px-2 py-1 font-mono text-slate-400">{v === "" ? <span className="text-slate-600">∅</span> : v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {mapped.dataRows.length > preview.length && (
                <div className="px-2 py-1 text-center text-[11px] text-slate-600">+ {mapped.dataRows.length - preview.length} more rows</div>
              )}
            </div>
          )}

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">{error}</div>}
          {progress && <div className="text-xs text-neon">{progress}</div>}
        </div>

        <div className="flex gap-2 border-t border-edge p-3">
          <button
            onClick={() => !importing && onClose()}
            disabled={importing}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void doImport()}
            disabled={!canImport}
            className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
          >
            {importing ? "Importing…" : `Import ${mapped.dataRows.length} row${mapped.dataRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
