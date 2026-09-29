import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Download,
  FileCode2,
  Focus,
  KeyRound,
  Link2,
  Loader2,
  Maximize,
  Minus,
  Plus,
  Search,
  Settings2,
  Table2,
  X,
  ZoomIn,
} from "lucide-react";
import { getErModel, isTauri } from "../lib/api";
import type { ErDetailOptions, ErModel, ErRelation, ErTable } from "../types";

// ── constants ──────────────────────────────────────────────────
const NODE_W = 272;
const HEADER_H_WITH_META = 56;
const HEADER_H_SLIM = 44;
const ROW_H = 28;
const ROW_H_WITH_DEFAULT = 40;

const SCHEMA_PALETTE = ["#22d3ee", "#8b5cf6", "#f59e0b", "#34d399", "#fb7185", "#60a5fa", "#facc15", "#2dd4bf"];

const DEFAULT_OPTIONS: ErDetailOptions = {
  showTypes: true,
  showNullable: true,
  showDefaults: false,
  showRowCounts: true,
  showViews: true,
  showIsolated: true,
  showRelationLabels: true,
  colorBySchema: true,
};

const OPTIONS_KEY = "postiexplorer-er-options";

function loadOptions(): ErDetailOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (raw) return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_OPTIONS;
}

// ── helpers ────────────────────────────────────────────────────
const tkey = (schema: string, table: string) => `${schema}.${table}`;

function schemaColor(schema: string, schemas: string[]): string {
  const i = schemas.indexOf(schema);
  return SCHEMA_PALETTE[(i < 0 ? 0 : i) % SCHEMA_PALETTE.length];
}

function rowHeight(opts: ErDetailOptions): number {
  return opts.showDefaults ? ROW_H_WITH_DEFAULT : ROW_H;
}

function nodeHeight(t: ErTable, opts: ErDetailOptions): number {
  const header = opts.showRowCounts ? HEADER_H_WITH_META : HEADER_H_SLIM;
  return header + t.columns.length * rowHeight(opts) + 8;
}

function shortType(t: string): string {
  return t.length > 18 ? t.slice(0, 17) + "…" : t;
}

function toMermaidType(t: string): string {
  const base = t.split("(")[0].split(" ")[0].replace(/[^A-Za-z0-9]/g, "") || "text";
  return base.slice(0, 20);
}

function buildMermaid(tables: ErTable[], relations: ErRelation[]): string {
  const lines = ["erDiagram"];
  for (const t of tables) {
    const label = t.schema === "public" ? t.name : `${t.schema}.${t.name}`;
    lines.push(`  "${label}" {`);
    for (const c of t.columns) {
      const marks = [c.is_primary ? "PK" : null, fkSet(relations, t.schema, t.name).has(c.name) ? "FK" : null]
        .filter(Boolean)
        .join(",");
      lines.push(`    ${toMermaidType(c.data_type)} ${c.name}${marks ? ` "${marks}"` : ""}`);
    }
    lines.push("  }");
  }
  for (const r of relations) {
    const a = r.source_schema === "public" ? r.source_table : `${r.source_schema}.${r.source_table}`;
    const b = r.target_schema === "public" ? r.target_table : `${r.target_schema}.${r.target_table}`;
    lines.push(`  "${a}" }|--|| "${b}" : "${r.source_column}->${r.target_column}"`);
  }
  return lines.join("\n");
}

function fkSet(relations: ErRelation[], schema: string, table: string): Set<string> {
  const s = new Set<string>();
  for (const r of relations) {
    if (r.source_schema === schema && r.source_table === table) s.add(r.source_column);
  }
  return s;
}

type LayoutMode = "grid" | "schema" | "hub";
type Pos = { x: number; y: number };

function autoLayout(tables: ErTable[], opts: ErDetailOptions, mode: LayoutMode): Record<string, Pos> {
  const pos: Record<string, Pos> = {};
  if (tables.length === 0) return pos;
  if (mode === "schema") {
    const bySchema = new Map<string, ErTable[]>();
    for (const t of tables) {
      const arr = bySchema.get(t.schema) ?? [];
      arr.push(t);
      bySchema.set(t.schema, arr);
    }
    const schemas = [...bySchema.keys()].sort();
    let x = 40;
    for (const s of schemas) {
      let y = 40;
      const group = bySchema.get(s)!;
      let colMaxW = NODE_W;
      for (const t of group) {
        pos[tkey(t.schema, t.name)] = { x, y };
        y += nodeHeight(t, opts) + 36;
        void colMaxW;
      }
      x += NODE_W + 96;
    }
    return pos;
  }
  if (mode === "hub") {
    // Most-connected table in the centre, rest on ellipses around it.
    const sorted = [...tables].sort((a, b) => b.columns.length - a.columns.length);
    const cx = 640;
    const cy = 480;
    sorted.forEach((t, i) => {
      if (i === 0) {
        pos[tkey(t.schema, t.name)] = { x: cx, y: cy };
        return;
      }
      const ring = Math.floor((i - 1) / 8);
      const idx = (i - 1) % 8;
      const rx = 420 + ring * 360;
      const ry = 340 + ring * 300;
      const angle = (idx / 8) * Math.PI * 2 - Math.PI / 2 + ring * 0.4;
      pos[tkey(t.schema, t.name)] = { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
    return pos;
  }
  // grid
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const cellX = NODE_W + 88;
  const cellY = 320;
  tables.forEach((t, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    pos[tkey(t.schema, t.name)] = { x: 40 + c * cellX, y: 40 + r * cellY };
  });
  return pos;
}

// ── small switch ───────────────────────────────────────────────
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/5"
      title={hint}
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-gradient-to-r from-neon to-violet2" : "bg-white/10"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-200">{label}</span>
        <span className="block truncate text-[11px] text-slate-500">{hint}</span>
      </span>
    </button>
  );
}

// ── main component ─────────────────────────────────────────────
export default function ErDiagramView({ connected }: { connected: boolean }) {
  const [model, setModel] = useState<ErModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<ErDetailOptions>(loadOptions);
  const [showOpts, setShowOpts] = useState(false);
  const [search, setSearch] = useState("");
  const [schemaFilter, setSchemaFilter] = useState<string>("all");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("grid");
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredRel, setHoveredRel] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | (
    | { kind: "pan"; startX: number; startY: number; origX: number; origY: number }
    | { kind: "node"; key: string; offsetX: number; offsetY: number }
  )>(null);

  useEffect(() => {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(opts));
  }, [opts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await getErModel();
      setModel(m);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected || !isTauri()) load();
  }, [connected, load]);

  const schemas = useMemo(() => {
    if (!model) return [];
    return [...new Set(model.tables.map((t) => t.schema))].sort();
  }, [model]);

  const fkByTable = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!model) return m;
    for (const r of model.relations) {
      const k = tkey(r.source_schema, r.source_table);
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(r.source_column);
    }
    return m;
  }, [model]);

  const connectedTables = useMemo(() => {
    const s = new Set<string>();
    if (!model) return s;
    for (const r of model.relations) {
      s.add(tkey(r.source_schema, r.source_table));
      s.add(tkey(r.target_schema, r.target_table));
    }
    return s;
  }, [model]);

  const filtered = useMemo(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    return model.tables.filter((t) => {
      if (!opts.showViews && (t.kind === "view" || t.kind === "materialized_view")) return false;
      if (schemaFilter !== "all" && t.schema !== schemaFilter) return false;
      if (!opts.showIsolated && !connectedTables.has(tkey(t.schema, t.name))) return false;
      if (q && !`${t.schema}.${t.name}`.toLowerCase().includes(q) && !t.columns.some((c) => c.name.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [model, opts.showViews, opts.showIsolated, schemaFilter, search, connectedTables]);

  const visibleRelations = useMemo(() => {
    if (!model) return [];
    const keys = new Set(filtered.map((t) => tkey(t.schema, t.name)));
    return model.relations.filter(
      (r) => keys.has(tkey(r.source_schema, r.source_table)) && keys.has(tkey(r.target_schema, r.target_table)),
    );
  }, [model, filtered]);

  // (re)layout when the table set or layout mode changes — manual drags persist afterwards
  useEffect(() => {
    if (filtered.length === 0) return;
    setPositions((prev) => {
      const keys = new Set(filtered.map((t) => tkey(t.schema, t.name)));
      const hasAll = [...keys].every((k) => prev[k]);
      // keep manual positions if they already cover this exact set
      if (hasAll && Object.keys(prev).length === keys.size) return prev;
      const fresh = autoLayout(filtered, opts, layoutMode);
      // preserve drags for tables that are still visible
      for (const k of Object.keys(prev)) if (keys.has(k) && fresh[k]) fresh[k] = prev[k];
      return fresh;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, layoutMode, model !== null]);

  const activeKey = hovered ?? selected;

  const highlight = useMemo(() => {
    if (!activeKey || !model) return null;
    const tables = new Set<string>([activeKey]);
    const rels = new Set<number>();
    visibleRelations.forEach((r, i) => {
      const a = tkey(r.source_schema, r.source_table);
      const b = tkey(r.target_schema, r.target_table);
      if (a === activeKey || b === activeKey) {
        tables.add(a);
        tables.add(b);
        rels.add(i);
      }
    });
    return { tables, rels };
  }, [activeKey, model, visibleRelations]);

  const fitView = useCallback(() => {
    const el = canvasRef.current;
    if (!el || filtered.length === 0) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const t of filtered) {
      const p = positions[tkey(t.schema, t.name)];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + nodeHeight(t, opts));
    }
    if (!isFinite(minX)) return;
    if (el.clientWidth < 10 || el.clientHeight < 10) return;
    const pad = 48;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const k = Math.min(1.2, Math.max(0.2, Math.min(el.clientWidth / bw, el.clientHeight / bh)));
    setView({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: Math.max(12, el.clientHeight / 2 - ((minY + maxY) / 2) * k) });
  }, [filtered, positions, opts]);

  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!model || filtered.length === 0) return;
    if (Object.keys(positions).length < filtered.length) return;
    const key = `${filtered.length}|${layoutMode}|${filtered.map((t) => tkey(t.schema, t.name)).join(",")}`;
    if (fittedKey.current === key) return;
    fittedKey.current = key;
    const t = setTimeout(fitView, 50);
    return () => clearTimeout(t);
  }, [model, filtered, positions, layoutMode, fitView]);

  // ── pan / zoom / drag ──
  function onWheel(e: React.WheelEvent) {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => {
      const k = Math.min(2.2, Math.max(0.25, v.k * factor));
      const wx = (mx - v.x) / v.k;
      const wy = (my - v.y) / v.k;
      return { k, x: mx - wx * k, y: my - wy * k };
    });
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y };
  }

  function onNodeMouseDown(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    const p = positions[key];
    if (!p) return;
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const wx = (e.clientX - rect.left - view.x) / view.k;
    const wy = (e.clientY - rect.top - view.y) / view.k;
    dragRef.current = { kind: "node", key, offsetX: wx - p.x, offsetY: wy - p.y };
    setSelected(key);
  }

  function onCanvasMouseMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) }));
    } else {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const wx = (e.clientX - rect.left - view.x) / view.k;
      const wy = (e.clientY - rect.top - view.y) / view.k;
      const nx = Math.round(wx - d.offsetX);
      const ny = Math.round(wy - d.offsetY);
      setPositions((prev) => ({ ...prev, [d.key]: { x: nx, y: ny } }));
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  // ── edges ──
  const edges = useMemo(() => {
    const pairCount = new Map<string, number>();
    return visibleRelations.map((r, i) => {
      const sk = tkey(r.source_schema, r.source_table);
      const tk = tkey(r.target_schema, r.target_table);
      const sTable = filtered.find((t) => tkey(t.schema, t.name) === sk);
      const tTable = filtered.find((t) => tkey(t.schema, t.name) === tk);
      const sp = positions[sk];
      const tp = positions[tk];
      if (!sTable || !tTable || !sp || !tp) return null;
      const sIdx = Math.max(0, sTable.columns.findIndex((c) => c.name === r.source_column));
      const tIdx = Math.max(0, tTable.columns.findIndex((c) => c.name === r.target_column));
      const headerS = opts.showRowCounts ? HEADER_H_WITH_META : HEADER_H_SLIM;
      const headerT = headerS;
      const rh = rowHeight(opts);
      const x1 = sp.x + NODE_W;
      const y1 = sp.y + headerS + sIdx * rh + rh / 2;
      const x2 = tp.x;
      const y2 = tp.y + headerT + tIdx * rh + rh / 2;
      // offset overlapping edges between the same table pair
      const pairKey = sk < tk ? `${sk}|${tk}` : `${tk}|${sk}`;
      const n = pairCount.get(pairKey) ?? 0;
      pairCount.set(pairKey, n + 1);
      const lane = (n - 1) * 9;
      const dx = Math.max(48, Math.abs(x2 - x1) / 2);
      const my1 = y1 + lane;
      const my2 = y2 + lane;
      const d = `M ${x1} ${my1} C ${x1 + dx} ${my1}, ${x2 - dx} ${my2}, ${x2} ${my2}`;
      const midX = (x1 + x2) / 2;
      const midY = (my1 + my2) / 2;
      return { r, i, d, x1, y1: my1, x2, y2: my2, midX, midY, sk, tk };
    });
  }, [visibleRelations, filtered, positions, opts]);

  // ── export ──
  function exportSvg() {
    if (filtered.length === 0) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const t of filtered) {
      const p = positions[tkey(t.schema, t.name)];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + nodeHeight(t, opts));
    }
    const W = maxX - minX + 80;
    const H = maxY - minY + 80;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}"><rect width="100%" height="100%" fill="#070b14"/>`;
    edges.forEach((e) => {
      if (!e) return;
      s += `<path d="M ${e.x1 - minX + 40} ${e.y1 - minY + 40} C ${e.x1 - minX + 40 + 48} ${e.y1 - minY + 40}, ${e.x2 - minX + 40 - 48} ${e.y2 - minY + 40}, ${e.x2 - minX + 40} ${e.y2 - minY + 40}" stroke="#22d3ee" stroke-opacity="0.55" stroke-width="1.6" fill="none"/>`;
    });
    for (const t of filtered) {
      const p = positions[tkey(t.schema, t.name)];
      if (!p) continue;
      const px = p.x - minX + 40;
      const py = p.y - minY + 40;
      const h = nodeHeight(t, opts);
      const rh = rowHeight(opts);
      const header = opts.showRowCounts ? HEADER_H_WITH_META : HEADER_H_SLIM;
      s += `<g><rect x="${px}" y="${py}" width="${NODE_W}" height="${h}" rx="14" fill="#0d1424" stroke="rgba(148,163,184,0.25)"/>`;
      s += `<text x="${px + 12}" y="${py + 20}" fill="#94a3b8" font-size="10" font-family="monospace">${esc(t.schema)}</text>`;
      s += `<text x="${px + 12}" y="${py + 36}" fill="#ffffff" font-size="13" font-weight="bold" font-family="sans-serif">${esc(t.name)}</text>`;
      t.columns.forEach((c, idx) => {
        const cy = py + header + idx * rh + rh / 2 + 4;
        s += `<text x="${px + 12}" y="${cy}" fill="#e2e8f0" font-size="11" font-family="monospace">${esc((c.is_primary ? "◆ " : "") + c.name)}</text>`;
        if (opts.showTypes) s += `<text x="${px + NODE_W - 12}" y="${cy}" fill="#22d3ee" font-size="10" text-anchor="end" font-family="monospace">${esc(shortType(c.data_type))}</text>`;
      });
      s += `</g>`;
    }
    s += `</svg>`;
    const blob = new Blob([s], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "er-diagram.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyMermaid() {
    const text = buildMermaid(filtered, visibleRelations);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  // ── states ──
  if (!connected && isTauri()) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div className="max-w-sm rounded-2xl border border-edge bg-panel p-6 text-center shadow-card">
          <Boxes size={28} className="mx-auto text-neon" />
          <div className="mt-3 text-sm font-semibold text-white">ER Model</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Connect to a database to visualise tables and foreign-key relationships.</p>
        </div>
      </div>
    );
  }

  if (loading && !model) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin text-neon" /> Loading ER model…
      </div>
    );
  }

  if (error && !model) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
          <div className="font-semibold">Could not load ER model</div>
          <div className="mt-1 font-mono text-xs opacity-80">{error}</div>
          <button onClick={load} className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const dimmed = (key: string) => (highlight && !highlight.tables.has(key) ? "opacity-30 saturate-50" : "");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-panel px-3 py-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables or columns…"
            className="h-8 w-52 rounded-lg border border-edge bg-void pl-8 pr-7 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-neon/50"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {["all", ...schemas].map((s) => (
            <button
              key={s}
              onClick={() => setSchemaFilter(s)}
              className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition ${
                schemaFilter === s ? "bg-gradient-to-r from-neon/25 to-violet2/25 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              {s !== "all" && opts.colorBySchema && (
                <span className="h-2 w-2 rounded-full" style={{ background: schemaColor(s, schemas) }} />
              )}
              {s}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="hidden items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-400 xl:flex">
          <Table2 size={12} className="text-neon" /> {filtered.length} tables
          <span className="text-slate-600">·</span>
          <Link2 size={12} className="text-violet2" /> {visibleRelations.length} rels
        </div>

        <select
          value={layoutMode}
          onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
          className="h-8 rounded-lg border border-edge bg-void px-2 text-xs text-slate-300 outline-none"
          title="Layout"
        >
          <option value="grid">Grid layout</option>
          <option value="schema">By schema</option>
          <option value="hub">Hub &amp; spokes</option>
        </select>

        <button
          onClick={() => setShowOpts((v) => !v)}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${
            showOpts ? "border-neon/40 bg-neon/10 text-white" : "border-edge bg-white/5 text-slate-300 hover:bg-white/10"
          }`}
        >
          <Settings2 size={13} /> Details
        </button>
        <button onClick={fitView} className="flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-300 hover:bg-white/10" title="Fit to view">
          <Maximize size={13} /> Fit
        </button>
      </div>

      {/* detail options */}
      {showOpts && (
        <div className="shrink-0 border-b border-edge bg-panel2/80 px-3 py-2">
          <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
            <Toggle label="Column types" hint="e.g. uuid, timestamptz" checked={opts.showTypes} onChange={(v) => setOpts((o) => ({ ...o, showTypes: v }))} />
            <Toggle label="Nullability" hint="NOT NULL vs nullable dots" checked={opts.showNullable} onChange={(v) => setOpts((o) => ({ ...o, showNullable: v }))} />
            <Toggle label="Defaults" hint="SHOW column DEFAULT exprs" checked={opts.showDefaults} onChange={(v) => setOpts((o) => ({ ...o, showDefaults: v }))} />
            <Toggle label="Row counts" hint="estimates + sizes in header" checked={opts.showRowCounts} onChange={(v) => setOpts((o) => ({ ...o, showRowCounts: v }))} />
            <Toggle label="Views" hint="include views & matviews" checked={opts.showViews} onChange={(v) => setOpts((o) => ({ ...o, showViews: v }))} />
            <Toggle label="Isolated tables" hint="tables without FK links" checked={opts.showIsolated} onChange={(v) => setOpts((o) => ({ ...o, showIsolated: v }))} />
            <Toggle label="Relation labels" hint="column names on edges" checked={opts.showRelationLabels} onChange={(v) => setOpts((o) => ({ ...o, showRelationLabels: v }))} />
            <Toggle label="Schema colours" hint="accent per schema" checked={opts.colorBySchema} onChange={(v) => setOpts((o) => ({ ...o, colorBySchema: v }))} />
          </div>
        </div>
      )}

      {/* canvas */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-void">
        {/* dotted backdrop */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ backgroundImage: "radial-gradient(rgba(148,163,184,0.16) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet2/[0.05] via-transparent to-neon/[0.04]" />

        <div
          ref={canvasRef}
          className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
          onWheel={onWheel}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={() => {
            endDrag();
            setHovered(null);
          }}
          onClick={() => setSelected(null)}
        >
          <div
            className="absolute left-0 top-0"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* edges */}
            <svg
              className="absolute left-0 top-0 overflow-visible"
              width={10}
              height={10}
              style={{ overflow: "visible" }}
            >
              <defs>
                <marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="#22d3ee" fillOpacity="0.9" />
                </marker>
                <marker id="er-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="#64748b" fillOpacity="0.7" />
                </marker>
                <filter id="er-glow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="3" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {edges.map((e) => {
                if (!e) return null;
                const isActive = hoveredRel === e.i || (highlight && highlight.rels.has(e.i));
                const isDim = highlight && !highlight.rels.has(e.i);
                return (
                  <g key={e.i} opacity={isDim ? 0.18 : 1}>
                    {/* hit area */}
                    <path
                      d={e.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      className="cursor-pointer"
                      onMouseEnter={() => {
                        setHoveredRel(e.i);
                      }}
                      onMouseLeave={() => setHoveredRel(null)}
                      onClick={(ev) => ev.stopPropagation()}
                    />
                    <path
                      d={e.d}
                      fill="none"
                      stroke={isActive ? "#22d3ee" : "#7c8aa5"}
                      strokeOpacity={isActive ? 0.95 : 0.55}
                      strokeWidth={isActive ? 2.2 : 1.5}
                      markerEnd={isActive ? "url(#er-arrow)" : "url(#er-arrow-dim)"}
                      filter={isActive ? "url(#er-glow)" : undefined}
                      strokeDasharray={isActive ? undefined : "1 0"}
                      className="pointer-events-none"
                    />
                    {/* FK dot at source */}
                    <circle cx={e.x1} cy={e.y1} r={isActive ? 4 : 3} fill={isActive ? "#22d3ee" : "#7c8aa5"} className="pointer-events-none" />
                    {opts.showRelationLabels && view.k > 0.45 && (
                      <g className="pointer-events-none">
                        <rect
                          x={e.midX - 62}
                          y={e.midY - 10}
                          width={124}
                          height={18}
                          rx={9}
                          fill="#0d1424"
                          fillOpacity={0.92}
                          stroke={isActive ? "rgba(34,211,238,0.5)" : "rgba(148,163,184,0.25)"}
                        />
                        <text x={e.midX} y={e.midY + 3.5} textAnchor="middle" fontSize={9.5} fontFamily="JetBrains Mono, monospace" fill={isActive ? "#a5f3fc" : "#94a3b8"}>
                          {e.r.source_column} → {e.r.target_column}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* nodes */}
            {filtered.map((t) => {
              const key = tkey(t.schema, t.name);
              const p = positions[key];
              if (!p) return null;
              const h = nodeHeight(t, opts);
              const rh = rowHeight(opts);
              const accent = opts.colorBySchema ? schemaColor(t.schema, schemas) : "#22d3ee";
              const isSel = selected === key;
              const fkCols = fkByTable.get(key) ?? new Set<string>();
              const isView = t.kind !== "table";
              return (
                <div
                  key={key}
                  className={`absolute transition-opacity ${dimmed(key)}`}
                  style={{ left: p.x, top: p.y, width: NODE_W }}
                  onMouseDown={(e) => onNodeMouseDown(e, key)}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(key);
                  }}
                >
                  <div
                    className={`overflow-hidden rounded-2xl border bg-panel/95 shadow-card backdrop-blur transition ${
                      isSel ? "border-neon/70 shadow-glow" : hovered === key ? "border-slate-400/50" : "border-edge"
                    }`}
                  >
                    <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
                    <div className="px-3 pb-2 pt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
                        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-slate-500">{t.schema}</span>
                        <span
                          className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                            isView ? "bg-violet2/15 text-violet-300" : "bg-neon/10 text-neon"
                          }`}
                        >
                          {t.kind === "materialized_view" ? "matview" : t.kind === "foreign_table" ? "foreign" : t.kind}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-2">
                        <span className="truncate text-[14px] font-bold text-white" title={`${t.schema}.${t.name}`}>
                          {t.name}
                        </span>
                      </div>
                      {opts.showRowCounts && (
                        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-slate-500">
                          <span>≈ {t.rows_estimate.toLocaleString()} rows</span>
                          <span className="text-slate-700">·</span>
                          <span>{t.size_pretty}</span>
                          <span className="text-slate-700">·</span>
                          <span>{t.columns.length} cols</span>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-white/[0.06]">
                      {t.columns.map((c) => {
                        const isPk = c.is_primary;
                        const isFk = fkCols.has(c.name);
                        return (
                          <div
                            key={c.name}
                            className="flex items-center gap-1.5 border-b border-white/[0.04] px-3 last:border-0 hover:bg-white/[0.04]"
                            style={{ height: rh }}
                            title={`${c.name} ${c.data_type}${c.is_nullable ? "" : " NOT NULL"}${c.default_value ? ` DEFAULT ${c.default_value}` : ""}`}
                          >
                            {isPk ? (
                              <KeyRound size={11} className="shrink-0 text-amber-300" />
                            ) : isFk ? (
                              <Link2 size={11} className="shrink-0 text-neon" />
                            ) : (
                              <span className="w-[11px] shrink-0" />
                            )}
                            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-100">
                              {c.name}
                              {opts.showDefaults && c.default_value && (
                                <span className="block truncate text-[10px] font-normal text-slate-500">= {c.default_value}</span>
                              )}
                            </span>
                            {opts.showTypes && (
                              <span className="max-w-[86px] shrink-0 truncate font-mono text-[10.5px] text-neon/80">{shortType(c.data_type)}</span>
                            )}
                            {opts.showNullable && (
                              <span
                                title={c.is_nullable ? "nullable" : "NOT NULL"}
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.is_nullable ? "bg-amber-400/70" : "bg-emerald-400/80"}`}
                              />
                            )}
                            {(isPk || isFk) && (
                              <span className="flex shrink-0 gap-0.5">
                                {isPk && <span className="rounded bg-amber-400/15 px-1 text-[8.5px] font-bold text-amber-300">PK</span>}
                                {isFk && <span className="rounded bg-neon/15 px-1 text-[8.5px] font-bold text-neon">FK</span>}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* zoom controls */}
        <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-edge bg-panel/90 p-1 shadow-card backdrop-blur">
          <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k / 1.2) }))} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10" title="Zoom out">
            <Minus size={14} />
          </button>
          <button onClick={() => setView((v) => ({ ...v, k: 1, x: v.x, y: v.y }))} className="min-w-[52px] rounded-lg px-1 py-1 font-mono text-[11px] text-slate-300 hover:bg-white/10" title="Reset zoom">
            {Math.round(view.k * 100)}%
          </button>
          <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.2, v.k * 1.2) }))} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10" title="Zoom in">
            <Plus size={14} />
          </button>
          <div className="mx-0.5 h-4 w-px bg-white/10" />
          <button onClick={fitView} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10" title="Fit to view">
            <Focus size={14} />
          </button>
        </div>

        {/* legend + selection */}
        <div className="absolute bottom-4 right-4 flex max-w-[320px] flex-col items-end gap-2">
          {selected && (
            <div className="w-full rounded-xl border border-neon/30 bg-panel/95 p-2.5 shadow-glow backdrop-blur">
              <div className="flex items-center gap-1.5">
                <ZoomIn size={12} className="text-neon" />
                <span className="truncate font-mono text-[11px] font-semibold text-white">{selected}</span>
                <button onClick={() => setSelected(null)} className="ml-auto text-slate-500 hover:text-white">
                  <X size={12} />
                </button>
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-slate-400">
                {visibleRelations.filter((r) => tkey(r.source_schema, r.source_table) === selected || tkey(r.target_schema, r.target_table) === selected).length} direct relationship(s) — others dimmed
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 rounded-xl border border-edge bg-panel/90 px-3 py-1.5 text-[10.5px] text-slate-400 shadow-card backdrop-blur">
            <span className="flex items-center gap-1"><KeyRound size={11} className="text-amber-300" /> PK</span>
            <span className="flex items-center gap-1"><Link2 size={11} className="text-neon" /> FK</span>
            {opts.showNullable && (
              <>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" /> not null</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400/70" /> nullable</span>
              </>
            )}
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="rounded-2xl border border-edge bg-panel/90 p-6 text-center shadow-card">
              <Table2 size={22} className="mx-auto text-slate-500" />
              <div className="mt-2 text-sm font-semibold text-white">No tables match</div>
              <p className="mt-1 max-w-[260px] text-xs text-slate-500">Adjust the search, schema filter, or enable isolated tables and views.</p>
            </div>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge bg-panel px-3 py-1.5 text-[11px] text-slate-500">
        <span className="hidden md:inline">Drag background to pan · scroll to zoom · drag tables to arrange · click a table to isolate its links</span>
        <span className="md:hidden">Pan, zoom &amp; drag tables to explore</span>
        <div className="flex-1" />
        <button onClick={load} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5 hover:text-slate-300">
          {loading ? <Loader2 size={12} className="animate-spin" /> : null} Refresh
        </button>
        <button onClick={exportSvg} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5 hover:text-slate-300">
          <Download size={12} /> SVG
        </button>
        <button onClick={copyMermaid} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/5 hover:text-slate-300">
          <FileCode2 size={12} /> {copied ? "Mermaid copied!" : "Copy Mermaid"}
        </button>
      </div>
    </div>
  );
}
