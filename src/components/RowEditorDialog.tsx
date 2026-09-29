import { useMemo, useState } from "react";
import { KeyRound, X } from "lucide-react";
import type { ColumnEntry } from "../types";

export type EditorValues = Record<string, string | null>;

interface Props {
  mode: "insert" | "edit";
  columns: ColumnEntry[];
  /** Current row values (edit) — empty object for insert. */
  initial: Record<string, unknown>;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: EditorValues, omittedDefaults: string[]) => void;
}

type FieldMode = "value" | "null" | "default";
interface FieldState {
  mode: FieldMode;
  text: string;
}

const TEXT_LIKE = new Set(["text", "varchar", "bpchar", "name", "citext", "char", "character", "character varying"]);

function valueToText(v: unknown): string {
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function isBool(t: string) {
  return t === "boolean" || t === "bool";
}
function isJson(t: string) {
  return t === "json" || t === "jsonb";
}

function initialFields(columns: ColumnEntry[], initial: Record<string, unknown>, mode: "insert" | "edit"): Record<string, FieldState> {
  const out: Record<string, FieldState> = {};
  for (const c of columns) {
    if (mode === "insert") {
      if (c.default_value !== null && c.default_value !== undefined) {
        out[c.name] = { mode: "default", text: "" };
      } else if (c.is_nullable) {
        out[c.name] = { mode: "null", text: "" };
      } else if (isBool(c.data_type)) {
        out[c.name] = { mode: "value", text: "false" };
      } else {
        out[c.name] = { mode: "value", text: "" };
      }
    } else {
      const v = initial[c.name];
      // A NULL value on a NOT NULL column cannot exist under an enforced
      // constraint — fall back to value mode so the user must type something.
      if (v === null || v === undefined) {
        out[c.name] = {
          mode: c.is_nullable ? "null" : "value",
          text: isBool(c.data_type) ? "false" : "",
        };
      } else if (isBool(c.data_type)) out[c.name] = { mode: "value", text: v === true || v === "true" ? "true" : "false" };
      else out[c.name] = { mode: "value", text: valueToText(v) };
    }
  }
  return out;
}

export default function RowEditorDialog({ mode, columns, initial, saving, error, onClose, onSave }: Props) {
  const [fields, setFields] = useState<Record<string, FieldState>>(() => initialFields(columns, initial, mode));
  const [fieldError, setFieldError] = useState<string | null>(null);

  const hasDefault = useMemo(() => columns.some((c) => c.default_value != null), [columns]);

  function setField(name: string, patch: Partial<FieldState>) {
    setFields((f) => ({ ...f, [name]: { ...f[name], ...patch } }));
  }

  function handleSave() {
    setFieldError(null);
    const values: EditorValues = {};
    const omitted: string[] = [];
    for (const c of columns) {
      const f = fields[c.name];
      if (!f) continue;
      if (f.mode === "default") {
        omitted.push(c.name);
        continue;
      }
      if (f.mode === "null") {
        if (!c.is_nullable) {
          setFieldError(`"${c.name}" is NOT NULL — provide a value.`);
          return;
        }
        values[c.name] = null;
        continue;
      }
      const text = f.text;
      if (text === "" && !TEXT_LIKE.has(c.data_type) && !isBool(c.data_type) && !isJson(c.data_type)) {
        const alt = c.is_nullable ? "or set NULL" : mode === "insert" && c.default_value != null ? "or use Default" : null;
        setFieldError(alt ? `"${c.name}" needs a value (${alt}).` : `"${c.name}" needs a value.`);
        return;
      }
      if (isJson(c.data_type) && text !== "") {
        try {
          JSON.parse(text);
        } catch {
          setFieldError(`"${c.name}" must be valid JSON.`);
          return;
        }
      }
      values[c.name] = text;
    }
    if (mode === "insert" && Object.keys(values).length === 0 && omitted.length === 0) {
      setFieldError("Nothing to insert — provide at least one value.");
      return;
    }
    onSave(values, omitted);
  }

  const inputCls =
    "h-9 w-full rounded-lg border border-edge bg-void px-2.5 font-mono text-[13px] text-slate-100 outline-none focus:border-neon/60 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-3">
          <div className="text-sm font-bold text-white">{mode === "insert" ? "Insert row" : "Edit row"}</div>
          {hasDefault && (
            <div className="ml-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-500">
              {mode === "insert" ? "columns on “Default” use the DB default" : "“Default” resets the column to its DB default"}
            </div>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {columns.map((c) => {
            const f = fields[c.name] ?? { mode: (c.is_nullable ? "null" : "value") as FieldMode, text: "" };
            const disabled = f.mode !== "value";
            return (
              <div key={c.name} className="rounded-xl border border-edge/60 bg-white/[0.02] p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[13px] font-semibold text-white">{c.name}</span>
                  <span className="rounded bg-white/5 px-1 font-mono text-[10px] text-neon">{c.data_type}</span>
                  {c.is_primary && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                      <KeyRound size={10} /> PK
                    </span>
                  )}
                  {!c.is_nullable && <span className="text-[10px] font-semibold text-slate-500">NOT NULL</span>}
                  {c.default_value != null && (
                    <span className="truncate font-mono text-[10px] text-slate-500" title={c.default_value}>
                      default: {c.default_value}
                    </span>
                  )}
                  <div className="flex-1" />
                  <div className="flex gap-1">
                    {c.is_nullable && (
                      <button
                        onClick={() => setField(c.name, { mode: "null" })}
                        title="Store SQL NULL"
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                          f.mode === "null" ? "bg-amber-400/20 text-amber-200" : "bg-white/5 text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        NULL
                      </button>
                    )}
                    {c.default_value != null && (
                      <button
                        onClick={() => setField(c.name, { mode: "default" })}
                        title={mode === "insert" ? "Omit column so PostgreSQL applies its DEFAULT" : "Reset column to its DEFAULT"}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                          f.mode === "default" ? "bg-neon/20 text-neon" : "bg-white/5 text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        Default
                      </button>
                    )}
                    <button
                      onClick={() => setField(c.name, { mode: "value" })}
                      title="Store a value"
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                        f.mode === "value" ? "bg-neon/20 text-neon" : "bg-white/5 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Value
                    </button>
                  </div>
                </div>
                {f.mode === "null" && <div className="rounded-lg bg-white/[0.03] px-2.5 py-2 font-mono text-[11px] text-slate-600">NULL</div>}
                {f.mode === "default" && (
                  <div className="truncate rounded-lg bg-white/[0.03] px-2.5 py-2 font-mono text-[11px] text-slate-500">
                    DEFAULT ({c.default_value})
                  </div>
                )}
                {f.mode === "value" &&
                  (isBool(c.data_type) ? (
                    <select value={f.text} onChange={(e) => setField(c.name, { text: e.target.value })} className={inputCls} disabled={saving}>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : isJson(c.data_type) || c.data_type === "text" ? (
                    <textarea
                      value={f.text}
                      onChange={(e) => setField(c.name, { text: e.target.value })}
                      rows={isJson(c.data_type) ? 3 : 2}
                      spellCheck={false}
                      disabled={saving || disabled}
                      placeholder={c.default_value ?? ""}
                      className="w-full resize-y rounded-lg border border-edge bg-void px-2.5 py-2 font-mono text-[13px] text-slate-100 outline-none focus:border-neon/60 disabled:opacity-40"
                    />
                  ) : (
                    <input
                      value={f.text}
                      onChange={(e) => setField(c.name, { text: e.target.value })}
                      spellCheck={false}
                      disabled={saving || disabled}
                      placeholder={c.default_value ?? ""}
                      className={inputCls}
                    />
                  ))}
              </div>
            );
          })}
          {columns.length === 0 && <div className="p-4 text-center text-sm text-slate-500">Loading columns…</div>}
          {(fieldError || error) && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">
              {fieldError ?? error}
            </div>
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
            onClick={handleSave}
            disabled={saving || columns.length === 0}
            className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "insert" ? "Insert row" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
