import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

interface Props {
  columns: string[];
  columnTypes?: string[];
  rows: unknown[][];
  orderBy?: string | null;
  orderDir?: string | null;
  onSort?: (col: string) => void;
  emptyHint?: string;
  maxHeightClass?: string;
  // Row selection (used by the editable data view; ignored elsewhere)
  selectable?: boolean;
  selected?: Set<number>;
  onToggleRow?: (idx: number) => void;
  onToggleAll?: (selectAll: boolean) => void;
  // Per-row action buttons (edit/delete) rendered in a trailing column
  actions?: (rowIndex: number) => ReactNode;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function DataGrid({
  columns,
  columnTypes,
  rows,
  orderBy,
  orderDir,
  onSort,
  emptyHint,
  maxHeightClass,
  selectable,
  selected,
  onToggleRow,
  onToggleAll,
  actions,
}: Props) {
  if (columns.length === 0) return <div className="p-6 text-center text-sm text-slate-500">{emptyHint ?? "No columns"}</div>;
  const allSelected = selectable && rows.length > 0 && rows.every((_, i) => selected?.has(i));
  return (
    <div className={`min-h-0 flex-1 overflow-auto ${maxHeightClass ?? ""}`}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {selectable && (
              <th className="w-9 border-b border-edge bg-panel2 px-2 py-2 text-center">
                <input
                  type="checkbox"
                  checked={!!allSelected}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-cyan-400"
                  title={allSelected ? "Deselect all" : "Select all"}
                />
              </th>
            )}
            {columns.map((c, i) => {
              const active = orderBy === c;
              return (
                <th
                  key={c}
                  onClick={() => onSort?.(c)}
                  className={`whitespace-nowrap border-b border-edge bg-panel2 px-3 py-2 text-left font-semibold text-slate-200 ${
                    onSort ? "cursor-pointer select-none hover:text-white" : ""
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    <span className="max-w-[220px] truncate">{c}</span>
                    {onSort &&
                      (active ? (
                        orderDir === "DESC" ? <ArrowDown size={12} className="text-neon" /> : <ArrowUp size={12} className="text-neon" />
                      ) : (
                        <ChevronsUpDown size={12} className="text-slate-600" />
                      ))}
                    {columnTypes?.[i] && (
                      <span className="rounded bg-white/5 px-1 font-mono text-[10px] font-normal text-slate-500">{columnTypes[i]}</span>
                    )}
                  </span>
                </th>
              );
            })}
            {actions && <th className="w-20 border-b border-edge bg-panel2 px-2 py-2 text-right font-semibold text-slate-500">Row</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const isSel = selected?.has(ri) ?? false;
            return (
              <tr
                key={ri}
                onClick={() => selectable && onToggleRow?.(ri)}
                className={`cursor-default border-b border-white/[0.04] hover:bg-white/[0.03] ${isSel ? "bg-neon/[0.07] hover:bg-neon/[0.1]" : ""}`}
              >
                {selectable && (
                  <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => onToggleRow?.(ri)}
                      className="h-3.5 w-3.5 cursor-pointer accent-cyan-400"
                    />
                  </td>
                )}
                {r.map((v, ci) => {
                  const isNull = v === null || v === undefined;
                  return (
                    <td key={ci} className="max-w-[320px] truncate px-3 py-1.5 text-slate-300">
                      <span className={isNull ? "rounded bg-white/5 px-1 font-mono text-[11px] text-slate-600" : "font-mono text-[12.5px]"}>
                        {cell(v)}
                      </span>
                    </td>
                  );
                })}
                {actions && (
                  <td className="whitespace-nowrap px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                    {actions(ri)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-6 text-center text-sm text-slate-500">{emptyHint ?? "No rows"}</div>}
    </div>
  );
}
