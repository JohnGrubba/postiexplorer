import { useEffect, useRef, useState } from "react";
import { Download, History, Play, Trash2 } from "lucide-react";
import { executeSql } from "../lib/api";
import type { QueryResult } from "../types";
import DataGrid from "./DataGrid";

const SAMPLE = `SELECT u.display_name, u.email, count(o.id) AS orders
FROM public.users u
LEFT JOIN public.orders o ON o.user_id = u.id
GROUP BY 1, 2
ORDER BY orders DESC
LIMIT 50;`;

const HISTORY_LIMIT = 20;
const STORAGE_PREFIX = "postiexplorer.query.v1.";
const SAVE_DEBOUNCE_MS = 400;
/** Cap persisted result rows so one huge result can't blow the localStorage quota. */
const MAX_STORED_ROWS = 200;

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Working starter query for the current selection — quoted so any table name runs. */
function selectAllFor(schema: string | null, table: string | null): string {
  if (!schema || !table) return SAMPLE;
  return `SELECT *\nFROM ${quoteIdent(schema)}.${quoteIdent(table)}\nLIMIT 100;`;
}

interface SavedQueryState {
  sql: string;
  history: string[];
  result: QueryResult | null;
  touched?: boolean;
}

function loadSavedState(key: string): SavedQueryState | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedQueryState>;
    const sql = typeof parsed.sql === "string" && parsed.sql.length > 0 ? parsed.sql : SAMPLE;
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter((h): h is string => typeof h === "string").slice(0, HISTORY_LIMIT)
      : [];
    const r = parsed.result;
    const result =
      r && typeof r === "object" && Array.isArray(r.columns) && Array.isArray(r.rows) ? (r as QueryResult) : null;
    return { sql, history, result };
  } catch {
    return null;
  }
}

function saveState(key: string, state: SavedQueryState) {
  try {
    const storedResult =
      state.result && state.result.rows.length > MAX_STORED_ROWS
        ? { ...state.result, rows: state.result.rows.slice(0, MAX_STORED_ROWS) }
        : state.result;
    localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({
        sql: state.sql,
        history: state.history.slice(0, HISTORY_LIMIT),
        result: storedResult,
        touched: state.touched ?? false,
      }),
    );
  } catch {
    // Quota exceeded or storage unavailable — retry without the (potentially large) result.
    try {
      localStorage.setItem(
        STORAGE_PREFIX + key,
        JSON.stringify({ sql: state.sql, history: state.history.slice(0, HISTORY_LIMIT), result: null }),
      );
    } catch {
      /* ignore */
    }
  }
}

export default function QueryView({
  persistKey,
  schema,
  table,
}: {
  persistKey: string;
  schema: string | null;
  table: string | null;
}) {
  const [sql, setSql] = useState(SAMPLE);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  // ── per-connection persistence ──
  const keyRef = useRef(persistKey);
  /** True once the user typed, ran, or restored a previous session — gates selection-following. */
  const touchedRef = useRef(false);
  const stateRef = useRef<SavedQueryState>({ sql, history, result, touched: false });
  stateRef.current = { sql, history, result, touched: touchedRef.current };
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore persisted state on mount.
  useEffect(() => {
    const saved = loadSavedState(keyRef.current);
    if (saved) {
      setSql(saved.sql);
      setHistory(saved.history);
      setResult(saved.result);
      // A stored state implies a previous session even if it predates the touched flag.
      touchedRef.current = saved.touched ?? true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First open: show a working query for the selected table, and keep
  // following the selection until the user edits, runs, or restores a session.
  useEffect(() => {
    if (touchedRef.current) return;
    setSql(selectAllFor(schema, table));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, table]);

  // Flush pending writes on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      saveState(keyRef.current, stateRef.current);
    };
  }, []);

  // Connection switch: save the old connection's state, load the new one.
  // Otherwise debounce-save so every keystroke doesn't stringify a big result.
  useEffect(() => {
    if (keyRef.current !== persistKey) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      saveState(keyRef.current, stateRef.current);
      keyRef.current = persistKey;
      const saved = loadSavedState(persistKey);
      touchedRef.current = saved ? (saved.touched ?? true) : false;
      setSql(saved?.sql ?? selectAllFor(schema, table));
      setHistory(saved?.history ?? []);
      setResult(saved?.result ?? null);
      setError(null);
      return;
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveState(persistKey, stateRef.current);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [persistKey, sql, history, result, schema, table]);

  async function run(query?: string) {
    const q = (query ?? sql).trim();
    if (!q || running) return;
    touchedRef.current = true;
    setRunning(true);
    setError(null);
    try {
      const res = await executeSql(q);
      setResult(res);
      // Deduplicate: re-running (e.g. from history) moves the entry to the front.
      setHistory((h) => [q, ...h.filter((x) => x !== q)].slice(0, HISTORY_LIMIT));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function exportCsv() {
    if (!result || result.columns.length === 0) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [result.columns.join(","), ...result.rows.map((r) => r.map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "query-result.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <div className="text-[13px] font-semibold text-white">SQL Editor</div>
        <div className="flex-1" />
        <button
          onClick={exportCsv}
          disabled={!result || result.columns.length === 0}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
        >
          <Download size={13} /> CSV
        </button>
        <button
          onClick={() => run()}
          disabled={running || !sql.trim()}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-neon to-violet2 px-3 text-xs font-bold text-void shadow-glow disabled:opacity-50"
        >
          <Play size={13} /> {running ? "Running…" : "Run (Ctrl+Enter)"}
        </button>
      </div>

      <textarea
        value={sql}
        onChange={(e) => {
          touchedRef.current = true;
          setSql(e.target.value);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run();
        }}
        spellCheck={false}
        className="h-[150px] w-full shrink-0 resize-none border-b border-edge bg-void p-3 font-mono text-[13px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 focus:bg-void"
        placeholder="SELECT * FROM public.users LIMIT 50;"
      />

      {error && <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">{error}</div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-slate-500">
            <span>Result</span>
            {result && (
              <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono">
                {result.row_count} rows · {result.execution_ms} ms · {result.command}
              </span>
            )}
            {result?.notice && <span className="truncate text-amber-300/80">{result.notice}</span>}
          </div>
          <DataGrid columns={result?.columns ?? []} rows={result?.rows ?? []} emptyHint={result ? "Query returned no rows" : "Run a query to see results"} />
        </div>
        <div className="hidden w-[220px] shrink-0 flex-col overflow-hidden border-l border-edge bg-panel md:flex">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-edge px-3 py-2 text-xs font-semibold text-slate-300">
            <History size={13} /> History
            <div className="flex-1" />
            <button onClick={() => setHistory([])} className="text-slate-500 hover:text-white" title="Clear">
              <Trash2 size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => {
                  setSql(h);
                  run(h);
                }}
                className="mb-1 w-full truncate rounded-lg bg-white/[0.03] px-2 py-1.5 text-left font-mono text-[11px] text-slate-400 hover:bg-white/[0.07] hover:text-slate-200"
                title={h}
              >
                {h.slice(0, 80)}
              </button>
            ))}
            {history.length === 0 && <div className="p-3 text-center text-[11px] text-slate-600">No queries yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
