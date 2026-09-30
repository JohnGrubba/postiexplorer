import { PlugZap, Unplug } from "lucide-react";
import type { ConnectionProfile } from "../types";
import { isTauri } from "../lib/api";
import logoUrl from "../assets/logo.svg";

interface Props {
  profiles: ConnectionProfile[];
  activeId: string | null;
  connected: boolean;
  currentDb: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function Header({ profiles, activeId, connected, currentDb, busy, onSelect, onConnect, onDisconnect }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-edge bg-panel/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <img src={logoUrl} alt="PostiExplorer logo" className="h-9 w-9 rounded-xl shadow-glow" />
        <div className="leading-tight">
          <div className="text-[15px] font-700 font-bold tracking-tight text-white">
            Posti<span className="bg-gradient-to-r from-neon to-violet2 bg-clip-text text-transparent">Explorer</span>
          </div>
          <div className="text-[11px] text-slate-400">
            PostgreSQL Studio · v{__APP_VERSION__} {isTauri() ? "· desktop · live backend" : "· web preview · mock data"}
          </div>
        </div>
      </div>

      <div className="mx-2 hidden h-6 w-px bg-edge sm:block" />

      <select
        value={activeId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="h-9 min-w-0 max-w-[240px] flex-1 truncate rounded-lg border border-edge bg-void px-2 text-sm text-slate-200 outline-none focus:border-neon/60 sm:max-w-[300px]"
      >
        {profiles.length === 0 && <option value="">No profiles yet</option>}
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.user}@{p.host}:{p.port}/{p.database || "…"}
          </option>
        ))}
      </select>

      <div className="flex-1" />

      <div
        className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs md:flex ${
          connected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-edge bg-white/5 text-slate-400"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-500"}`} />
        {connected ? (currentDb ?? "connected") : "disconnected"}
      </div>

      {connected ? (
        <button
          onClick={onDisconnect}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-edge bg-white/5 px-3 text-sm text-slate-200 hover:bg-white/10"
        >
          <Unplug size={15} /> Disconnect
        </button>
      ) : (
        <button
          onClick={onConnect}
          disabled={busy || !activeId}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-neon to-violet2 px-3.5 text-sm font-semibold text-void shadow-glow transition disabled:opacity-50"
        >
          <PlugZap size={15} /> {busy ? "Connecting…" : "Connect"}
        </button>
      )}
    </header>
  );
}
