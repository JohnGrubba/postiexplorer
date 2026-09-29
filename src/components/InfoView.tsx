import { useEffect, useState } from "react";
import { Activity, Database, HardDrive, Table2 } from "lucide-react";
import { getServerInfo } from "../lib/api";
import type { ServerInfo } from "../types";

export default function InfoView({ connected }: { connected: boolean }) {
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    if (connected) getServerInfo().then(setInfo).catch(() => {});
  }, [connected]);

  if (!connected) return <div className="grid flex-1 place-items-center p-8 text-sm text-slate-500">Connect to see server info.</div>;
  if (!info) return <div className="grid flex-1 place-items-center p-8 text-sm text-slate-500">Loading server info…</div>;

  const cards = [
    { icon: Database, label: "Version", value: info.version },
    { icon: HardDrive, label: "Database size", value: `${info.database} · ${info.size_pretty}` },
    { icon: Table2, label: "Tables", value: String(info.table_count) },
    { icon: Activity, label: "Connections", value: `${info.connection_count} / ${info.max_connections}` },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-edge bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 shadow-card">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
              <c.icon size={14} className="text-neon" /> {c.label}
            </div>
            <div className="mt-2 truncate text-sm font-semibold text-white" title={c.value}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-2xl border border-edge bg-panel p-4">
        <div className="text-sm font-semibold text-white">Uptime</div>
        <div className="mt-1 font-mono text-[13px] text-slate-300">{info.uptime}</div>
        <div className="mt-3 text-xs leading-relaxed text-slate-500">
          Advanced panels (extensions, roles, vacuum stats, replication, locks) are stubbed for the next milestone. The
          Rust backend already exposes a modular command layer — see <span className="font-mono text-slate-400">src-tauri/src/db.rs</span>.
        </div>
      </div>
    </div>
  );
}
