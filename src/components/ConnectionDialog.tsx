import { useState } from "react";
import { X } from "lucide-react";
import type { ConnectionProfile, SslMode } from "../types";

interface Props {
  initial: ConnectionProfile;
  onSave: (p: ConnectionProfile) => void;
  onClose: () => void;
  onTest: (p: ConnectionProfile) => Promise<string>;
}

export default function ConnectionDialog({ initial, onSave, onClose, onTest }: Props) {
  const [form, setForm] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  function set<K extends keyof ConnectionProfile>(k: K, v: ConnectionProfile[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const m = await onTest(form);
      setMsg(m);
    } finally {
      setTesting(false);
    }
  }

  const input = "h-9 w-full rounded-lg border border-edge bg-void px-2.5 text-sm text-slate-100 outline-none focus:border-neon/60";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <div className="text-sm font-bold text-white">Connection profile</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-2.5 overflow-y-auto p-4">
          <label className="block text-xs text-slate-400">
            Name
            <input className={`${input} mt-1`} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <label className="block text-xs text-slate-400">
              Host
              <input className={`${input} mt-1 font-mono`} value={form.host} onChange={(e) => set("host", e.target.value)} />
            </label>
            <label className="block text-xs text-slate-400">
              Port
              <input
                className={`${input} mt-1 font-mono`}
                type="number"
                value={form.port}
                onChange={(e) => set("port", Number(e.target.value))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-400">
              User
              <input className={`${input} mt-1 font-mono`} value={form.user} onChange={(e) => set("user", e.target.value)} />
            </label>
            <label className="block text-xs text-slate-400">
              Password
              <input
                className={`${input} mt-1 font-mono`}
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-400">
              Database
              <input className={`${input} mt-1 font-mono`} value={form.database} onChange={(e) => set("database", e.target.value)} />
            </label>
            <label className="block text-xs text-slate-400">
              SSL mode
              <select className={`${input} mt-1`} value={form.sslmode} onChange={(e) => set("sslmode", e.target.value as SslMode)}>
                <option value="prefer">prefer</option>
                <option value="disable">disable</option>
                <option value="require">require</option>
              </select>
            </label>
          </div>
          {msg && <div className="rounded-lg bg-white/5 px-2.5 py-2 font-mono text-[11px] text-slate-300">{msg}</div>}
        </div>
        <div className="flex gap-2 border-t border-edge p-3">
          <button
            onClick={test}
            disabled={testing}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={() => onSave(form)}
            className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
