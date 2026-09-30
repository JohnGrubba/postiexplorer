import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { deleteRows, getColumns, getTableData, insertRow, updateRow } from "../lib/api";
import type { ColumnEntry, TableDataResult } from "../types";
import DataGrid from "./DataGrid";
import RowEditorDialog, { type EditorValues } from "./RowEditorDialog";

interface Props {
  schema: string | null;
  table: string | null;
}

const PAGE_SIZES = [25, 50, 100, 250];

function rowToRecord(data: TableDataResult, rowIndex: number): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  data.columns.forEach((c, i) => {
    rec[c] = data.rows[rowIndex]?.[i];
  });
  return rec;
}

function sameValue(original: unknown, next: string | null): boolean {
  if (next === null) return original === null || original === undefined;
  if (original === null || original === undefined) return false;
  if (typeof original === "object") return JSON.stringify(original) === next;
  if (typeof original === "boolean") return (original ? "true" : "false") === next;
  return String(original) === next;
}

export default function TableDataView({ schema, table }: Props) {
  const [data, setData] = useState<TableDataResult | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDir, setOrderDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cols, setCols] = useState<ColumnEntry[]>([]);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [showInsert, setShowInsert] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);

  async function load(p = page, ps = pageSize, ob = orderBy, od = orderDir) {
    if (!schema || !table) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getTableData(schema, table, ps, p * ps, ob, od);
      setData(res);
      setSelected(new Set());
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
    setSelected(new Set());
    setCols([]);
    setEditIndex(null);
    setShowInsert(false);
    setShowDelete(false);
    setMutError(null);
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
  const editable = data?.editable ?? false;
  const canInsert = data?.can_insert ?? false;
  const canUpdate = data?.can_update ?? false;
  const canDelete = data?.can_delete ?? false;
  const canEditRows = editable && (canUpdate || canDelete);
  const addTitle = !data
    ? "Loading…"
    : !editable
      ? "This relation is read-only"
      : !canInsert
        ? "Missing INSERT privilege on this table"
        : "Insert a new row";
  const editTitle =
    selected.size !== 1
      ? "Select exactly one row to edit"
      : !editable
        ? "This relation is read-only"
        : !canUpdate
          ? "Missing UPDATE privilege on this table"
          : "Edit selected row";

  async function ensureColumns(): Promise<ColumnEntry[]> {
    if (cols.length > 0) return cols;
    if (!schema || !table) return [];
    const c = await getColumns(schema, table);
    setCols(c);
    return c;
  }

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

  function toggleRow(idx: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }

  function toggleAll(selectAll: boolean) {
    if (!data) return;
    setSelected(selectAll ? new Set(data.rows.map((_, i) => i)) : new Set());
  }

  async function openEdit(idx: number) {
    setMutError(null);
    try {
      await ensureColumns();
      setEditIndex(idx);
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openInsert() {
    setMutError(null);
    try {
      await ensureColumns();
      setShowInsert(true);
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleInsert(values: EditorValues) {
    if (!schema || !table) return;
    setSaving(true);
    setMutError(null);
    try {
      await insertRow(schema, table, values);
      setShowInsert(false);
      // Jump to the last page so the new row is visible.
      const newTotal = (data?.total ?? 0) + 1;
      const last = Math.max(0, Math.ceil(newTotal / pageSize) - 1);
      setPage(last);
      await load(last, pageSize);
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(values: EditorValues, defaultCols: string[]) {
    if (!schema || !table || !data || editIndex === null) return;
    const ctid = data.ctids[editIndex];
    if (!ctid) {
      setMutError("Row id missing — please refresh and try again.");
      return;
    }
    const original = rowToRecord(data, editIndex);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!sameValue(original[k], v)) patch[k] = v;
    }
    // Columns switched to "Default" are always a change (initial state never uses it).
    const defaults = [...new Set(defaultCols)].sort();
    if (Object.keys(patch).length === 0 && defaults.length === 0) {
      setEditIndex(null);
      return;
    }
    setSaving(true);
    setMutError(null);
    try {
      await updateRow(schema, table, ctid, patch, defaults);
      setEditIndex(null);
      await load();
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!schema || !table || !data || selected.size === 0) return;
    const ctids = [...selected].map((i) => data.ctids[i]).filter(Boolean);
    if (ctids.length === 0) {
      setMutError("Row ids missing — please refresh and try again.");
      return;
    }
    setSaving(true);
    setMutError(null);
    try {
      await deleteRows(schema, table, ctids);
      setShowDelete(false);
      setSelected(new Set());
      // If the page was emptied, step back so we never sit on a blank page.
      const newTotal = Math.max(0, data.total - ctids.length);
      const last = Math.max(0, Math.ceil(Math.max(newTotal, 1) / pageSize) - 1);
      const target = Math.min(page, last);
      setPage(target);
      await load(target, pageSize);
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const btn =
    "flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
  const iconBtn =
    "grid h-6 w-6 place-items-center rounded-md text-slate-500 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <div className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-300">
          <span className="text-slate-500">{schema}.</span>
          <span className="font-semibold text-white">{table}</span>
          {data && <span className="ml-2 text-xs text-slate-500">{data.total.toLocaleString()} rows · {data.execution_ms} ms</span>}
          {data && !editable && (
            <span className="ml-2 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-500" title="Views and similar relations cannot be edited row-by-row">
              read-only
            </span>
          )}
          {data && editable && (!canInsert || !canUpdate || !canDelete) && (
            <span
              className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300"
              title={`Privileges: SELECT ${data.can_select ? "✓" : "✗"} · INSERT ${canInsert ? "✓" : "✗"} · UPDATE ${canUpdate ? "✓" : "✗"} · DELETE ${canDelete ? "✓" : "✗"}`}
            >
              limited privileges
            </span>
          )}
          {selected.size > 0 && <span className="ml-2 rounded-full bg-neon/15 px-2 py-0.5 text-[10px] font-semibold text-neon">{selected.size} selected</span>}
        </div>
        <button onClick={openInsert} disabled={!editable || !canInsert} title={addTitle} className={btn}>
          <Plus size={13} /> Add
        </button>
        <button
          onClick={() => {
            const [first] = [...selected];
            if (first !== undefined) void openEdit(first);
          }}
          disabled={!editable || !canUpdate || selected.size !== 1}
          title={editTitle}
          className={btn}
        >
          <Pencil size={13} /> Edit
        </button>
        <button
          onClick={() => {
            setMutError(null);
            setShowDelete(true);
          }}
          disabled={!editable || !canDelete || selected.size === 0}
          title={
            selected.size === 0
              ? "Select at least one row to delete"
              : !editable
                ? "This relation is read-only"
                : !canDelete
                  ? "Missing DELETE privilege on this table"
                  : `Delete ${selected.size} row(s)`
          }
          className={`${btn} hover:border-red-500/40 hover:text-red-300`}
        >
          <Trash2 size={13} /> Delete{selected.size > 1 ? ` (${selected.size})` : ""}
        </button>
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
        <button onClick={() => load()} className={btn}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      {mutError && !editIndex && !showInsert && !showDelete && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{mutError}</div>
      )}

      <DataGrid
        columns={data?.columns ?? []}
        columnTypes={data?.column_types}
        rows={data?.rows ?? []}
        orderBy={orderBy}
        orderDir={orderDir}
        onSort={toggleSort}
        emptyHint={loading ? "Loading rows…" : editable ? "No rows in this table — use Add to insert one" : "No rows in this relation"}
        selectable={canEditRows}
        selected={selected}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        actions={
          canEditRows
            ? (ri) => (
                <span className="inline-flex gap-0.5">
                  <button
                    onClick={() => void openEdit(ri)}
                    title={canUpdate ? "Edit row" : "Missing UPDATE privilege"}
                    disabled={!canUpdate}
                    className={iconBtn}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => {
                      setSelected(new Set([ri]));
                      setMutError(null);
                      setShowDelete(true);
                    }}
                    title={canDelete ? "Delete row" : "Missing DELETE privilege"}
                    disabled={!canDelete}
                    className={iconBtn}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              )
            : undefined
        }
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

      {editIndex !== null && data && (
        <RowEditorDialog
          mode="edit"
          columns={cols}
          initial={rowToRecord(data, editIndex)}
          saving={saving}
          error={mutError}
          onClose={() => {
            if (!saving) {
              setEditIndex(null);
              setMutError(null);
            }
          }}
          onSave={(v, d) => void handleUpdate(v, d)}
        />
      )}

      {showInsert && (
        <RowEditorDialog
          mode="insert"
          columns={cols}
          initial={{}}
          saving={saving}
          error={mutError}
          onClose={() => {
            if (!saving) {
              setShowInsert(false);
              setMutError(null);
            }
          }}
          onSave={(v) => void handleInsert(v)}
        />
      )}

      {showDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !saving && setShowDelete(false)}>
          <div
            className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-edge px-4 py-3 text-sm font-bold text-white">
              Delete {selected.size} row{selected.size === 1 ? "" : "s"}?
            </div>
            <div className="px-4 py-3 text-[13px] text-slate-400">
              This permanently removes the selected row{selected.size === 1 ? "" : "s"} from{" "}
              <span className="font-mono text-slate-200">
                {schema}.{table}
              </span>
              . This cannot be undone.
              {mutError && (
                <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">
                  {mutError}
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-edge p-3">
              <button
                onClick={() => !saving && setShowDelete(false)}
                disabled={saving}
                className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={saving}
                className="h-9 flex-1 rounded-lg bg-red-500/90 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
