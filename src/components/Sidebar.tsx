import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  DatabaseBackup,
  DatabaseZap,
  FolderGit2,
  LayoutGrid,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Table2,
  Trash2,
} from "lucide-react";
import { createTable } from "../lib/api";
import type { ConnectionProfile, DatabaseEntry, NewColumnDef, SchemaEntry, TableEntry } from "../types";
import DumpDialog from "./DumpDialog";

interface Props {
  profiles: ConnectionProfile[];
  active: ConnectionProfile | null;
  connected: boolean;
  databases: DatabaseEntry[];
  currentDb: string | null;
  switchingDb: boolean;
  schemas: SchemaEntry[];
  tablesBySchema: Record<string, TableEntry[]>;
  selectedSchema: string | null;
  selectedTable: string | null;
  loadingTree: boolean;
  onNew: () => void;
  onDelete: (id: string) => void;
  onEdit: (p: ConnectionProfile) => void;
  onOpenSettings: (p: ConnectionProfile) => void;
  onSelectTable: (schema: string, table: string) => void;
  onSwitchDatabase: (db: string) => void;
  onRefresh: () => void;
}

const COMMON_TYPES = [
  "TEXT",
  "VARCHAR(255)",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "BOOLEAN",
  "NUMERIC",
  "UUID",
  "JSONB",
  "TIMESTAMPTZ",
  "DATE",
];

export default function Sidebar(props: Props) {
  const { schemas, tablesBySchema, selectedSchema, selectedTable } = props;
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ public: true });
  const [tab, setTab] = useState<"explorer" | "saved">("explorer");
  const [createSchema, setCreateSchema] = useState<string | null>(null);
  const [showDump, setShowDump] = useState(false);

  const f = filter.toLowerCase();

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-edge bg-panel">
      <div className="flex shrink-0 gap-1 border-b border-edge p-2">
        {(["explorer", "saved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-8 flex-1 rounded-lg text-[13px] font-medium capitalize transition ${tab === t ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
          >
            {t === "explorer" ? "Explorer" : "Connections"}
          </button>
        ))}
        <button
          onClick={props.onNew}
          title="New connection"
          className="grid h-8 w-8 place-items-center rounded-lg border border-edge bg-white/5 text-slate-200 hover:bg-white/10"
        >
          <Plus size={15} />
        </button>
      </div>

      {tab === "saved" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {props.profiles.map((p) => (
            <div
              key={p.id}
              className={`mb-1.5 rounded-xl border p-2.5 transition ${props.active?.id === p.id ? "border-neon/40 bg-neon/5" : "border-edge bg-white/[0.03]"
                }`}
            >
              <div className="flex items-center gap-2">
                <Database size={15} className="shrink-0 text-neon" />
                <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{p.name}</div>
                <button onClick={() => props.onOpenSettings(p)} className="text-slate-400 hover:text-white" title="Edit">
                  <Settings2 size={14} />
                </button>
                <button onClick={() => props.onDelete(p.id)} className="text-slate-500 hover:text-red-400" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-slate-400">
                {p.user}@{p.host}:{p.port}/{p.database}
              </div>
              <button
                onClick={() => props.onEdit(p)}
                className="mt-2 h-7 w-full rounded-lg bg-white/5 text-xs text-slate-200 hover:bg-white/10"
              >
                Select
              </button>
            </div>
          ))}
          {props.profiles.length === 0 && (
            <div className="p-4 text-center text-xs text-slate-500">No saved connections yet.</div>
          )}
        </div>
      ) : (
        <>
          <div className="shrink-0 space-y-2 border-b border-edge p-2.5">
            {props.connected && props.databases.length > 0 && (
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <DatabaseZap size={12} className="text-neon" /> Database
                </span>
                <select
                  value={props.currentDb ?? ""}
                  disabled={props.switchingDb}
                  onChange={(e) => props.onSwitchDatabase(e.target.value)}
                  className="h-8 w-full truncate rounded-lg border border-neon/30 bg-void px-2 text-[13px] font-medium text-white outline-none focus:border-neon/60 disabled:opacity-60"
                >
                  {props.databases.map((d) => (
                    <option key={d.name} value={d.name} disabled={!d.can_connect}>
                      {d.name} · {d.size_pretty}
                      {!d.can_connect ? " (no CONNECT)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tables…"
                className="h-8 w-full rounded-lg border border-edge bg-void pl-8 pr-2 text-[13px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-neon/60"
              />
            </div>
            <button
              onClick={props.onRefresh}
              disabled={!props.connected}
              className="flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-edge bg-white/[0.03] text-xs text-slate-300 hover:bg-white/[0.07] disabled:opacity-40"
            >
              <RefreshCw size={12} className={props.loadingTree ? "animate-spin" : ""} />
              {props.loadingTree ? "Loading…" : "Refresh schema"}
            </button>
            <button
              onClick={() => setShowDump(true)}
              disabled={!props.connected || !props.currentDb}
              title="Export / restore this database as .sql"
              className="flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-edge bg-white/[0.03] text-xs text-slate-300 hover:bg-white/[0.07] disabled:opacity-40"
            >
              <DatabaseBackup size={12} />
              Dump / Restore
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {!props.connected && (
              <div className="m-1 rounded-xl border border-dashed border-edge p-4 text-center">
                <LayoutGrid size={20} className="mx-auto text-slate-600" />
                <div className="mt-2 text-xs text-slate-400">Not connected.</div>
                <div className="mt-1 text-[11px] text-slate-600">Connect to browse schemas &amp; tables.</div>
              </div>
            )}
            {props.connected &&
              schemas.map((s) => {
                const tables = (tablesBySchema[s.name] ?? []).filter((t) => !f || t.name.toLowerCase().includes(f));
                const isOpen = open[s.name] ?? false;
                const canCreate = s.can_create;
                return (
                  <div key={s.name} className="mb-1">
                    <div className="flex h-8 w-full items-center gap-1.5 rounded-lg px-1.5 hover:bg-white/5">
                      <button
                        onClick={() => setOpen((o) => ({ ...o, [s.name]: !isOpen }))}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        title={s.can_usage ? `Schema ${s.name}` : `No USAGE privilege on schema ${s.name}`}
                      >
                        {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                        <FolderGit2 size={14} className="shrink-0 text-violet2" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-200">{s.name}</span>
                        {!s.can_usage && <Lock size={11} className="shrink-0 text-amber-300/70" />}
                        <span className="rounded-full bg-white/5 px-1.5 text-[10px] text-slate-500">{tablesBySchema[s.name]?.length ?? s.table_count}</span>
                      </button>
                      <button
                        onClick={() => setCreateSchema(s.name)}
                        disabled={!canCreate}
                        title={
                          canCreate
                            ? `Create table in ${s.name}`
                            : `Missing CREATE privilege on schema ${s.name}`
                        }
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="ml-4 border-l border-edge pl-1">
                        {tables.map((t) => {
                          const active = selectedSchema === s.name && selectedTable === t.name;
                          const noAccess = !t.can_select;
                          return (
                            <button
                              key={t.name}
                              onClick={() => {
                                if (!noAccess) props.onSelectTable(s.name, t.name);
                              }}
                              disabled={noAccess}
                              title={noAccess ? `Missing SELECT privilege on ${s.name}.${t.name}` : `${s.name}.${t.name} (${t.kind})`}
                              className={`flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-gradient-to-r from-neon/20 to-violet2/20 text-white" : "text-slate-300 hover:bg-white/5"
                                }`}
                            >
                              {noAccess ? (
                                <Lock size={13} className="shrink-0 text-slate-600" />
                              ) : (
                                <Table2 size={13} className={`shrink-0 ${t.kind === "view" ? "text-amber-300" : "text-neon"}`} />
                              )}
                              <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.name}</span>
                              {t.kind === "view" && <span className="text-[10px] text-amber-300/80">view</span>}
                              {t.kind === "materialized_view" && <span className="text-[10px] text-violet-300/80">matview</span>}
                            </button>
                          );
                        })}
                        {tables.length === 0 && <div className="px-3 py-1 text-[11px] text-slate-600">No matches</div>}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      )}

      {createSchema && (
        <CreateTableDialog
          schema={createSchema}
          onClose={() => setCreateSchema(null)}
          onCreated={() => {
            setCreateSchema(null);
            props.onRefresh();
          }}
        />
      )}
      {showDump && props.currentDb && (
        <DumpDialog database={props.currentDb} onClose={() => setShowDump(false)} onRestored={() => props.onRefresh()} />
      )}
    </aside>
  );
}

function CreateTableDialog({ schema, onClose, onCreated }: { schema: string; onClose: () => void; onCreated: () => void }) {
  const [table, setTable] = useState("");
  const [cols, setCols] = useState<Array<{ name: string; type: string; nullable: boolean; def: string; pk: boolean }>>([
    { name: "id", type: "UUID", nullable: false, def: "gen_random_uuid()", pk: true },
    { name: "created_at", type: "TIMESTAMPTZ", nullable: false, def: "now()", pk: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCol(i: number, patch: Partial<(typeof cols)[number]>) {
    setCols((c) => c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setError(null);
    if (!table.trim()) {
      setError("Table name is required.");
      return;
    }
    if (cols.length === 0) {
      setError("Add at least one column.");
      return;
    }
    for (const c of cols) {
      if (!c.name.trim()) {
        setError("Every column needs a name.");
        return;
      }
      if (!c.type.trim()) {
        setError(`Column "${c.name}" needs a type.`);
        return;
      }
    }
    const lowered = cols.map((c) => c.name.trim().toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      setError("Duplicate column names.");
      return;
    }
    setSaving(true);
    try {
      const payload: NewColumnDef[] = cols.map((c) => ({
        name: c.name.trim(),
        data_type: c.type.trim(),
        is_nullable: c.nullable,
        default_value: c.def.trim() === "" ? null : c.def.trim(),
        is_primary: c.pk,
      }));
      await createTable(schema, table.trim(), payload);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "h-8 w-full rounded-lg border border-edge bg-void px-2 font-mono text-[12px] text-slate-100 outline-none focus:border-neon/60";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-edge px-4 py-3 text-sm font-bold text-white">
          Create table in <span className="font-mono text-neon">{schema}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">Table name</span>
            <input
              value={table}
              onChange={(e) => setTable(e.target.value)}
              spellCheck={false}
              placeholder="e.g. customers"
              className="h-9 w-full rounded-lg border border-edge bg-void px-2.5 font-mono text-[13px] text-slate-100 outline-none focus:border-neon/60"
            />
          </label>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-400">Columns</div>
            {cols.map((c, i) => (
              <div key={i} className="rounded-xl border border-edge/60 bg-white/[0.02] p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <input value={c.name} onChange={(e) => setCol(i, { name: e.target.value })} spellCheck={false} placeholder="name" className={inputCls} />
                  <input
                    value={c.type}
                    onChange={(e) => setCol(i, { type: e.target.value })}
                    spellCheck={false}
                    placeholder="TYPE"
                    list="px-create-types"
                    className={inputCls}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    value={c.def}
                    onChange={(e) => setCol(i, { def: e.target.value })}
                    spellCheck={false}
                    placeholder="default expr (optional)"
                    className={inputCls}
                  />
                  <div className="flex items-center gap-3 text-[12px] text-slate-300">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={c.nullable} onChange={(e) => setCol(i, { nullable: e.target.checked })} className="h-3.5 w-3.5 accent-cyan-400" />
                      Null
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={c.pk} onChange={(e) => setCol(i, { pk: e.target.checked })} className="h-3.5 w-3.5 accent-cyan-400" />
                      PK
                    </label>
                    <button onClick={() => setCols((x) => x.filter((_, idx) => idx !== i))} className="ml-auto text-slate-500 hover:text-red-300" title="Remove column">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <datalist id="px-create-types">
              {COMMON_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <button
              onClick={() => setCols((c) => [...c, { name: "", type: "TEXT", nullable: true, def: "", pk: false }])}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              <Plus size={13} /> Add column
            </button>
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">{error}</div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-edge p-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create table"}
          </button>
        </div>
      </div>
    </div>
  );
}
