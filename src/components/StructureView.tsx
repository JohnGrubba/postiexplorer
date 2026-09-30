import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import {
  addColumn,
  alterColumnType,
  dropColumn,
  dropTable,
  getColumns,
  getTablePrivileges,
  renameColumn,
  setColumnDefault,
  setColumnNullable,
} from "../lib/api";
import type { ColumnEntry, NewColumnDef, TablePrivileges } from "../types";

const COMMON_TYPES = [
  "TEXT",
  "VARCHAR(255)",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "BOOLEAN",
  "NUMERIC",
  "REAL",
  "DOUBLE PRECISION",
  "UUID",
  "JSON",
  "JSONB",
  "BYTEA",
  "DATE",
  "TIME",
  "TIMETZ",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "INTERVAL",
];

const inputCls =
  "h-9 w-full rounded-lg border border-edge bg-void px-2.5 font-mono text-[13px] text-slate-100 outline-none focus:border-neon/60 disabled:opacity-40";

export default function StructureView({
  schema,
  table,
  tableKind,
  onRefreshTables,
  onTableDropped,
}: {
  schema: string | null;
  table: string | null;
  tableKind?: string;
  onRefreshTables?: () => void;
  onTableDropped?: () => void;
}) {
  const [cols, setCols] = useState<ColumnEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priv, setPriv] = useState<TablePrivileges | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ColumnEntry | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);
  const [showDropTable, setShowDropTable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!schema || !table) return;
    setLoading(true);
    setError(null);
    try {
      const [c, p] = await Promise.all([getColumns(schema, table), getTablePrivileges(schema, table).catch(() => null)]);
      setCols(c);
      setPriv(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [schema, table]);

  useEffect(() => {
    setCols([]);
    setPriv(null);
    setError(null);
    setMutError(null);
    setShowAdd(false);
    setEditing(null);
    setDropping(null);
    setShowDropTable(false);
    if (schema && table) void load();
  }, [schema, table, load]);

  if (!schema || !table)
    return <div className="grid flex-1 place-items-center p-8 text-sm text-slate-500">Select a table to inspect its structure.</div>;

  const isView = tableKind === "view" || tableKind === "materialized_view";
  const canAlter = !!priv?.can_alter && !isView;
  const alterTitle = isView
    ? "Views cannot be altered here"
    : !priv
      ? "Loading privileges…"
      : priv.can_alter
        ? "Alter structure"
        : `Read-only — ${priv.current_user} lacks ALTER rights (table owner or superuser required)`;

  async function refreshAfterChange() {
    await load();
    onRefreshTables?.();
  }

  async function handleAdd(col: NewColumnDef) {
    if (!schema || !table) return;
    setSaving(true);
    setMutError(null);
    try {
      await addColumn(schema, table, col);
      setShowAdd(false);
      await refreshAfterChange();
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(original: ColumnEntry, draft: { name: string; dataType: string; nullable: boolean; def: string }) {
    if (!schema || !table) return;
    setSaving(true);
    setMutError(null);
    try {
      const newName = draft.name.trim();
      if (!newName) throw new Error("column name is required");
      if (newName !== original.name) await renameColumn(schema, table, original.name, newName);
      const target = newName !== original.name ? newName : original.name;
      if (draft.dataType.trim() && draft.dataType.trim() !== original.data_type) {
        await alterColumnType(schema, table, target, draft.dataType.trim());
      }
      if (draft.nullable !== original.is_nullable) {
        await setColumnNullable(schema, table, target, draft.nullable);
      }
      const origDef = (original.default_value ?? "").trim();
      const newDef = draft.def.trim();
      if (newDef !== origDef) {
        await setColumnDefault(schema, table, target, newDef === "" ? null : newDef);
      }
      setEditing(null);
      await refreshAfterChange();
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDropColumn() {
    if (!schema || !table || !dropping) return;
    setSaving(true);
    setMutError(null);
    try {
      await dropColumn(schema, table, dropping);
      setDropping(null);
      await refreshAfterChange();
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDropTable() {
    if (!schema || !table) return;
    setSaving(true);
    setMutError(null);
    try {
      await dropTable(schema, table);
      setShowDropTable(false);
      onTableDropped?.();
      onRefreshTables?.();
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const btn =
    "flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-4 py-2.5">
        <div className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-300">
          <span className="text-slate-500">{schema}.</span>
          <span className="font-semibold text-white">{table}</span>
          <span className="ml-2 text-xs text-slate-500">
            {cols.length} columns {loading ? "· loading…" : ""}
          </span>
          {priv && !canAlter && (
            <span className="ml-2 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-500" title={alterTitle}>
              read-only
            </span>
          )}
          {priv && canAlter && (
            <span className="ml-2 rounded-full bg-neon/10 px-2 py-0.5 text-[10px] text-neon" title={`Connected as ${priv.current_user} · ALTER allowed`}>
              editable
            </span>
          )}
        </div>
        <button onClick={() => setShowAdd(true)} disabled={!canAlter} title={alterTitle} className={btn}>
          <Plus size={13} /> Add column
        </button>
        <button
          onClick={() => setShowDropTable(true)}
          disabled={!priv?.can_drop || isView}
          title={
            isView
              ? "Views cannot be dropped here"
              : !priv
                ? "Loading privileges…"
                : priv.can_drop
                  ? `Drop table ${schema}.${table}`
                  : `Read-only — ${priv.current_user} lacks DROP rights (owner or superuser required)`
          }
          className={`${btn} hover:border-red-500/40 hover:text-red-300`}
        >
          <Trash2 size={13} /> Drop table
        </button>
      </div>

      {error && <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>}
      {mutError && !showAdd && !editing && !dropping && !showDropTable && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">{mutError}</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0">
            <tr>
              {["Column", "Type", "Nullable", "Default", "Key", canAlter ? "Actions" : ""].filter(Boolean).map((h) => (
                <th key={h} className="border-b border-edge bg-panel2 px-3 py-2 text-left font-semibold text-slate-200">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.name} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                <td className="px-3 py-2 font-mono font-medium text-white">{c.name}</td>
                <td className="px-3 py-2 font-mono text-neon">{c.data_type}</td>
                <td className="px-3 py-2 text-slate-400">{c.is_nullable ? "YES" : "NO"}</td>
                <td className="max-w-[280px] truncate px-3 py-2 font-mono text-[12px] text-slate-400">{c.default_value ?? "—"}</td>
                <td className="px-3 py-2">
                  {c.is_primary && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300">
                      <KeyRound size={11} /> PK
                    </span>
                  )}
                </td>
                {canAlter && (
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="inline-flex gap-1">
                      <button
                        onClick={() => {
                          setMutError(null);
                          setEditing(c);
                        }}
                        title={`Edit column ${c.name}`}
                        className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white/10 hover:text-white"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => {
                          setMutError(null);
                          setDropping(c.name);
                        }}
                        title={`Drop column ${c.name}`}
                        className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white/10 hover:text-red-300"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {cols.length === 0 && !loading && !error && (
          <div className="p-6 text-center text-sm text-slate-500">No columns — use “Add column” to define one.</div>
        )}
      </div>

      {showAdd && (
        <ColumnDialog
          title="Add column"
          saving={saving}
          error={mutError}
          allowPrimary
          onClose={() => {
            if (!saving) {
              setShowAdd(false);
              setMutError(null);
            }
          }}
          onSave={(d) => void handleAdd(d)}
        />
      )}

      {editing && (
        <EditColumnDialog
          column={editing}
          saving={saving}
          error={mutError}
          onClose={() => {
            if (!saving) {
              setEditing(null);
              setMutError(null);
            }
          }}
          onSave={(draft) => void handleEdit(editing, draft)}
        />
      )}

      {dropping && (
        <ConfirmDialog
          title={`Drop column ${dropping}?`}
          body={
            <>
              This permanently removes <span className="font-mono text-slate-200">{dropping}</span> from{" "}
              <span className="font-mono text-slate-200">
                {schema}.{table}
              </span>
              . Data in this column will be lost.
            </>
          }
          confirmLabel="Drop column"
          saving={saving}
          error={mutError}
          onCancel={() => {
            if (!saving) {
              setDropping(null);
              setMutError(null);
            }
          }}
          onConfirm={() => void handleDropColumn()}
        />
      )}

      {showDropTable && (
        <ConfirmDialog
          title={`Drop table ${schema}.${table}?`}
          body="This permanently deletes the table and all its rows. This cannot be undone."
          confirmLabel="Drop table"
          saving={saving}
          error={mutError}
          onCancel={() => {
            if (!saving) {
              setShowDropTable(false);
              setMutError(null);
            }
          }}
          onConfirm={() => void handleDropTable()}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-edge px-4 py-3 text-sm font-bold text-white">{title}</div>
        <div className="px-4 py-3 text-[13px] text-slate-400">
          {body}
          {error && (
            <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">{error}</div>
          )}
        </div>
        <div className="flex gap-2 border-t border-edge p-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="h-9 flex-1 rounded-lg bg-red-500/90 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {saving ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnDialog({
  title,
  saving,
  error,
  allowPrimary,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  saving: boolean;
  error: string | null;
  allowPrimary?: boolean;
  initial?: { name: string; dataType: string; nullable: boolean; def: string; primary?: boolean };
  onClose: () => void;
  onSave: (col: NewColumnDef) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [dataType, setDataType] = useState(initial?.dataType ?? "TEXT");
  const [nullable, setNullable] = useState(initial?.nullable ?? true);
  const [def, setDef] = useState(initial?.def ?? "");
  const [primary, setPrimary] = useState(initial?.primary ?? false);
  const [localError, setLocalError] = useState<string | null>(null);

  function save() {
    if (!name.trim()) {
      setLocalError("Column name is required.");
      return;
    }
    if (!dataType.trim()) {
      setLocalError("Column type is required.");
      return;
    }
    setLocalError(null);
    onSave({
      name: name.trim(),
      data_type: dataType.trim(),
      is_nullable: nullable,
      default_value: def.trim() === "" ? null : def.trim(),
      is_primary: allowPrimary ? primary : false,
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-edge px-4 py-3 text-sm font-bold text-white">{title}</div>
        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} className={inputCls} placeholder="e.g. nickname" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Type</span>
            <input
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              spellCheck={false}
              list="px-col-types"
              className={inputCls}
              placeholder="TEXT"
            />
            <datalist id="px-col-types">
              {COMMON_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <div className="flex items-center gap-4 text-[13px] text-slate-300">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={nullable} onChange={(e) => setNullable(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
              Nullable
            </label>
            {allowPrimary && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
                Primary key
              </label>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Default (SQL expression, empty = none)</span>
            <input value={def} onChange={(e) => setDef(e.target.value)} spellCheck={false} className={inputCls} placeholder="e.g. now() or 'free'" />
          </label>
          {(localError || error) && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">{localError ?? error}</div>
          )}
        </div>
        <div className="flex gap-2 border-t border-edge p-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditColumnDialog({
  column,
  saving,
  error,
  onClose,
  onSave,
}: {
  column: ColumnEntry;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: { name: string; dataType: string; nullable: boolean; def: string }) => void;
}) {
  const [name, setName] = useState(column.name);
  const [dataType, setDataType] = useState(column.data_type);
  const [nullable, setNullable] = useState(column.is_nullable);
  const [def, setDef] = useState(column.default_value ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function save() {
    if (!name.trim()) {
      setLocalError("Column name is required.");
      return;
    }
    if (!dataType.trim()) {
      setLocalError("Column type is required.");
      return;
    }
    setLocalError(null);
    onSave({ name, dataType, nullable, def });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-edge px-4 py-3 text-sm font-bold text-white">
          Edit column <span className="font-mono text-neon">{column.name}</span>
          {column.is_primary && <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">PK — rename/type only, key preserved</span>}
        </div>
        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Type</span>
            <input value={dataType} onChange={(e) => setDataType(e.target.value)} spellCheck={false} list="px-col-types-edit" className={inputCls} />
            <datalist id="px-col-types-edit">
              {COMMON_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-slate-300">
            <input type="checkbox" checked={nullable} onChange={(e) => setNullable(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
            Nullable
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Default (SQL expression, empty = DROP DEFAULT)</span>
            <input value={def} onChange={(e) => setDef(e.target.value)} spellCheck={false} className={inputCls} placeholder="empty removes the default" />
          </label>
          {(localError || error) && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">{localError ?? error}</div>
          )}
        </div>
        <div className="flex gap-2 border-t border-edge p-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
