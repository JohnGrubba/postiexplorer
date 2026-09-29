export default function StatusBar({
  connected,
  database,
  schema,
  table,
  latency,
}: {
  connected: boolean;
  database: string | null;
  schema: string | null;
  table: string | null;
  latency: number | null;
}) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 overflow-hidden border-t border-edge bg-panel px-3 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-600"}`} />
        {connected ? "live" : "offline"}
      </span>
      <span className="hidden truncate font-mono sm:block">
        {database ?? "no database"}
        {schema && table ? ` · ${schema}.${table}` : ""}
      </span>
      <span className="flex-1" />
      {latency !== null && <span className="font-mono">{latency} ms</span>}
      <span className="hidden md:block">PostgreSQL · Tauri v2 · React</span>
    </footer>
  );
}
