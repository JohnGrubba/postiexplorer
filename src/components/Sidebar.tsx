import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  DatabaseZap,
  FolderGit2,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Table2,
  Trash2,
} from "lucide-react";
import type { ConnectionProfile, DatabaseEntry, SchemaEntry, TableEntry } from "../types";

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

export default function Sidebar(props: Props) {
  const { schemas, tablesBySchema, selectedSchema, selectedTable } = props;
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ public: true });
  const [tab, setTab] = useState<"explorer" | "saved">("explorer");

  const f = filter.toLowerCase();

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-edge bg-panel">
      <div className="flex shrink-0 gap-1 border-b border-edge p-2">
        {(["explorer", "saved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-8 flex-1 rounded-lg text-[13px] font-medium capitalize transition ${
              tab === t ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
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
              className={`mb-1.5 rounded-xl border p-2.5 transition ${
                props.active?.id === p.id ? "border-neon/40 bg-neon/5" : "border-edge bg-white/[0.03]"
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
                    <option key={d.name} value={d.name}>
                      {d.name} · {d.size_pretty}
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
                return (
                  <div key={s.name} className="mb-1">
                    <button
                      onClick={() => setOpen((o) => ({ ...o, [s.name]: !isOpen }))}
                      className="flex h-8 w-full items-center gap-1.5 rounded-lg px-1.5 text-left hover:bg-white/5"
                    >
                      {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                      <FolderGit2 size={14} className="shrink-0 text-violet2" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-200">{s.name}</span>
                      <span className="rounded-full bg-white/5 px-1.5 text-[10px] text-slate-500">{tablesBySchema[s.name]?.length ?? s.table_count}</span>
                    </button>
                    {isOpen && (
                      <div className="ml-4 border-l border-edge pl-1">
                        {tables.map((t) => {
                          const active = selectedSchema === s.name && selectedTable === t.name;
                          return (
                            <button
                              key={t.name}
                              onClick={() => props.onSelectTable(s.name, t.name)}
                              className={`flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left transition ${
                                active ? "bg-gradient-to-r from-neon/20 to-violet2/20 text-white" : "text-slate-300 hover:bg-white/5"
                              }`}
                            >
                              <Table2 size={13} className={`shrink-0 ${t.kind === "view" ? "text-amber-300" : "text-neon"}`} />
                              <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.name}</span>
                              {t.kind === "view" && <span className="text-[10px] text-amber-300/80">view</span>}
                            </button>
                          );
                        })}
                        {tables.length === 0 && <div className="px-3 py-1 text-[11px] text-slate-600">No matches</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            {props.connected && (
              <div className="mt-2 rounded-xl border border-edge bg-white/[0.02] p-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Coming soon</div>
                <div className="mt-1 space-y-1 text-[12px] text-slate-500">
                  <div>ƒ Functions · Triggers</div>
                  <div>✦ Extensions · Roles</div>
                  <div>◈ ER diagram · Explain</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
