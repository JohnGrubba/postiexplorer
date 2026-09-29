import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { getColumns } from "../lib/api";
import type { ColumnEntry } from "../types";

export default function StructureView({ schema, table }: { schema: string | null; table: string | null }) {
  const [cols, setCols] = useState<ColumnEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!schema || !table) return;
    setLoading(true);
    getColumns(schema, table)
      .then(setCols)
      .finally(() => setLoading(false));
  }, [schema, table]);

  if (!schema || !table) return <div className="grid flex-1 place-items-center p-8 text-sm text-slate-500">Select a table to inspect its structure.</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-edge px-4 py-2.5 font-mono text-[13px] text-slate-300">
        <span className="text-slate-500">{schema}.</span>
        <span className="font-semibold text-white">{table}</span>
        <span className="ml-2 text-xs text-slate-500">{cols.length} columns {loading ? "· loading…" : ""}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0">
            <tr>
              {["Column", "Type", "Nullable", "Default", "Key"].map((h) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
