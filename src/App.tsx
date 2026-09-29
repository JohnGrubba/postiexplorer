import { useEffect, useMemo, useState } from "react";
import { Braces, Info, Network, Table2 } from "lucide-react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import TableDataView from "./components/TableDataView";
import StructureView from "./components/StructureView";
import QueryView from "./components/QueryView";
import InfoView from "./components/InfoView";
import ErDiagramView from "./components/ErDiagramView";
import ConnectionDialog from "./components/ConnectionDialog";
import StatusBar from "./components/StatusBar";
import { connect, disconnect, getConnectionId, listDatabases, listSchemas, listTables, testConnection } from "./lib/api";
import { loadProfiles, saveProfiles, newProfile } from "./lib/profiles";
import type { ConnectionProfile, DatabaseEntry, MainTab, SchemaEntry, TableEntry } from "./types";

export default function App() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(() => loadProfiles());
  const [activeId, setActiveId] = useState<string | null>(() => loadProfiles()[0]?.id ?? null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchingDb, setSwitchingDb] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const [databases, setDatabases] = useState<DatabaseEntry[]>([]);
  const [currentDb, setCurrentDb] = useState<string | null>(null);

  const [schemas, setSchemas] = useState<SchemaEntry[]>([]);
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, TableEntry[]>>({});
  const [loadingTree, setLoadingTree] = useState(false);

  const [schema, setSchema] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [tab, setTab] = useState<MainTab>("data");

  const [dialog, setDialog] = useState<ConnectionProfile | null>(null);

  const active = useMemo(() => profiles.find((p) => p.id === activeId) ?? null, [profiles, activeId]);

  useEffect(() => {
    saveProfiles(profiles);
  }, [profiles]);

  // seed a demo profile on first run so the UI is never empty
  useEffect(() => {
    if (profiles.length === 0) {
      const demo: ConnectionProfile = {
        id: "demo-local",
        name: "Localhost",
        host: "localhost",
        port: 5432,
        user: "postgres",
        password: "",
        database: "postgres",
        sslmode: "prefer",
      };
      setProfiles([demo]);
      setActiveId(demo.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshTree() {
    setLoadingTree(true);
    try {
      const s = await listSchemas();
      setSchemas(s);
      const map: Record<string, TableEntry[]> = {};
      for (const entry of s) {
        map[entry.name] = await listTables(entry.name);
      }
      setTablesBySchema(map);
      if (!schema && map["public"]?.[0]) {
        setSchema("public");
        setTable(map["public"][0].name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTree(false);
    }
  }

  async function handleConnect() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const t0 = performance.now();
      await connect(active);
      setLatency(Math.round(performance.now() - t0));
      setConnected(true);
      const dbs = await listDatabases().catch(() => []);
      setDatabases(dbs);
      setCurrentDb(active.database.trim() !== "" ? active.database : "postgres");
      setSchema(null);
      setTable(null);
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConnected(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchDatabase(db: string) {
    if (!active || db === currentDb) return;
    setSwitchingDb(true);
    setError(null);
    try {
      const oldId = getConnectionId();
      await connect({ ...active, database: db });
      if (oldId) await disconnect(oldId).catch(() => {});
      setCurrentDb(db);
      setSchema(null);
      setTable(null);
      setSchemas([]);
      setTablesBySchema({});
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchingDb(false);
    }
  }

  async function handleDisconnect() {
    await disconnect();
    setConnected(false);
    setDatabases([]);
    setCurrentDb(null);
    setSchemas([]);
    setTablesBySchema({});
    setSchema(null);
    setTable(null);
  }

  const tabs: { id: MainTab; label: string; icon: typeof Table2 }[] = [
    { id: "data", label: "Data", icon: Table2 },
    { id: "structure", label: "Structure", icon: Braces },
    { id: "er", label: "ER Model", icon: Network },
    { id: "query", label: "Query", icon: Braces },
    { id: "info", label: "Server", icon: Info },
  ];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-void text-slate-100">
      {/* ambient glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 left-1/4 h-64 w-[500px] rounded-full bg-violet2/15 blur-[100px]" />
        <div className="absolute -top-20 right-1/4 h-48 w-[380px] rounded-full bg-neon/10 blur-[100px]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <Header
          profiles={profiles}
          activeId={activeId}
          connected={connected}
          currentDb={currentDb}
          busy={busy}
          onSelect={setActiveId}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />

        {error && (
          <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-300">{error}</div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="hidden sm:flex">
            <Sidebar
              profiles={profiles}
              active={active}
              connected={connected}
              databases={databases}
              currentDb={currentDb}
              switchingDb={switchingDb}
              schemas={schemas}
              tablesBySchema={tablesBySchema}
              selectedSchema={schema}
              selectedTable={table}
              loadingTree={loadingTree}
              onNew={() => setDialog(newProfile())}
              onDelete={(id) => {
                setProfiles((p) => p.filter((x) => x.id !== id));
                if (activeId === id) setActiveId(null);
              }}
              onEdit={(p) => setActiveId(p.id)}
              onOpenSettings={(p) => setDialog(p)}
              onSelectTable={(s, t) => {
                setSchema(s);
                setTable(t);
                setTab("data");
              }}
              onSwitchDatabase={handleSwitchDatabase}
              onRefresh={refreshTree}
            />
          </div>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-void/60">
            <div className="flex shrink-0 gap-1 border-b border-edge bg-panel px-2 py-1.5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition ${
                    tab === t.id ? "bg-gradient-to-r from-neon/20 to-violet2/20 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
              <div className="flex-1" />
              {schema && table && (tab === "data" || tab === "structure") && (
                <div className="hidden items-center truncate px-2 font-mono text-xs text-slate-500 lg:flex">
                  {schema}.{table}
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              {tab === "data" && <TableDataView schema={schema} table={table} />}
              {tab === "structure" && <StructureView schema={schema} table={table} />}
              {tab === "er" && <ErDiagramView key={currentDb ?? "none"} connected={connected} />}
              {tab === "query" && <QueryView />}
              {tab === "info" && <InfoView key={currentDb ?? "none"} connected={connected} />}
            </div>
          </main>
        </div>

        <StatusBar connected={connected} database={currentDb} schema={schema} table={table} latency={latency} />
      </div>

      {dialog && (
        <ConnectionDialog
          initial={dialog}
          onClose={() => setDialog(null)}
          onSave={(p) => {
            setProfiles((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
            setActiveId(p.id);
            setDialog(null);
          }}
          onTest={async (p) => {
            const r = await testConnection(p);
            return r.ok ? `OK · ${r.version ?? "PostgreSQL"} · ${r.latency_ms} ms` : `FAILED · ${r.error}`;
          }}
        />
      )}
    </div>
  );
}
