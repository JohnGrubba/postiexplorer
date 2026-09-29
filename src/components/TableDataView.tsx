import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { getTableData } from "../lib/api";
import type { TableDataResult } from "../types";
import DataGrid from "./DataGrid";

interface Props {
  schema: string | null;
  table: string | null;
}

const PAGE_SIZES = [25, 50, 100, 250];

export default function TableDataView({ schema, table }: Props) {
  const [data, setData] = useState<TableDataResult | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDir, setOrderDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(p = page, ps = pageSize, ob = orderBy, od = orderDir) {
    if (!schema || !table) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getTableData(schema, table, ps, p * ps, ob, od);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(0);
    setOrderBy(null);
    setOrderDir(null);
    setData(null);
    if (schema && table) load(0, pageSize, null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, table]);

  if (!schema || !table) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div className="max-w-sm text-center">
          <div className="text-sm font-semibold text-slate-200">No table selected</div>
          <div className="mt-1 text-[13px] text-slate-500">Pick a table from the explorer to browse its rows.</div>
        </div>
      </div>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  function toggleSort(col: string) {
    let nb: string | null = col;
    let nd: string | null = "ASC";
    if (orderBy === col && orderDir === "ASC") nd = "DESC";
    else if (orderBy === col && orderDir === "DESC") {
      nb = null;
      nd = null;
    }
    setOrderBy(nb);
    setOrderDir(nd);
    load(page, pageSize, nb, nd);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <div className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-300">
          <span className="text-slate-500">{schema}.</span>
          <span className="font-semibold text-white">{table}</span>
          {data && <span className="ml-2 text-xs text-slate-500">{data.total.toLocaleString()} rows · {data.execution_ms} ms</span>}
        </div>
        <select
          value={pageSize}
          onChange={(e) => {
            const ps = Number(e.target.value);
            setPageSize(ps);
            setPage(0);
            load(0, ps);
          }}
          className="h-8 rounded-lg border border-edge bg-void px-2 text-xs text-slate-200"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} / page
            </option>
          ))}
        </select>
        <button
          onClick={() => load()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-200 hover:bg-white/10"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      <DataGrid
        columns={data?.columns ?? []}
        columnTypes={data?.column_types}
        rows={data?.rows ?? []}
        orderBy={orderBy}
        orderDir={orderDir}
        onSort={toggleSort}
        emptyHint={loading ? "Loading rows…" : "No rows in this table"}
      />

      <div className="flex shrink-0 items-center gap-2 border-t border-edge px-3 py-2 text-xs text-slate-400">
        <button
          disabled={page === 0}
          onClick={() => {
            const p = Math.max(0, page - 1);
            setPage(p);
            load(p);
          }}
          className="grid h-7 w-7 place-items-center rounded-lg border border-edge bg-white/5 disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="min-w-[120px] text-center">
          Page {page + 1} / {totalPages}
        </div>
        <button
          disabled={page + 1 >= totalPages}
          onClick={() => {
            const p = page + 1;
            setPage(p);
            load(p);
          }}
          className="grid h-7 w-7 place-items-center rounded-lg border border-edge bg-white/5 disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
        <div className="flex-1" />
        <div className="hidden sm:block">
          rows {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, data?.total ?? 0).toLocaleString()} of{" "}
          {(data?.total ?? 0).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
