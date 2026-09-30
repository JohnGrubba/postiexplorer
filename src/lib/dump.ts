import { executeSqlBatch, getTableData, getTableDdl, getErModel, listSchemas, listTables } from "./api";
import type { TableEntry } from "../types";
import { EXPORT_MAX_ROWS } from "../types";
import { splitBatch } from "./sqlsplit";

const DATA_PAGE = 1000;
/** Rows per multi-row INSERT in dumps (keeps statements small). */
export const DUMP_INSERT_CHUNK = 500;
/** Statements per restore batch (mirrors the backend 100-statement cap). */
export const RESTORE_BATCH_SIZE = 100;
/** Max rows dumped per table (same cap as CSV export). */
export const DUMP_MAX_ROWS = EXPORT_MAX_ROWS;

export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Render a `getTableData` cell as a SQL literal (mirrors `json_to_literal` in db.rs). */
export function toSqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  try {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  } catch {
    return `'${String(v).replace(/'/g, "''")}'`;
  }
}

function buildInserts(schema: string, table: string, columns: string[], rows: unknown[][]): string[] {
  const out: string[] = [];
  const target = `${quoteIdent(schema)}.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})`;
  for (let i = 0; i < rows.length; i += DUMP_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + DUMP_INSERT_CHUNK);
    const tuples = chunk.map((r) => `(${r.map(toSqlLiteral).join(", ")})`);
    out.push(`INSERT INTO ${target} VALUES\n  ${tuples.join(",\n  ")};`);
  }
  return out;
}

export interface DumpTarget {
  schema: string;
  table: string;
  kind: TableEntry["kind"] | string;
}

export interface DumpOptions {
  database: string;
  /** Pre-resolved targets (preferred) or resolved via listTables when omitted. */
  targets?: DumpTarget[];
  includeSchema: boolean;
  includeData: boolean;
  onProgress?: (phase: string) => void;
}

export interface DumpResult {
  sql: string;
  tableCount: number;
  rowCount: number;
  statementCount: number;
}

/** Order tables parents-first using FK edges so restores satisfy constraints. */
function topoSort(targets: DumpTarget[], edges: { from: string; to: string }[]): DumpTarget[] {
  const key = (s: string, t: string) => `${s}.${t}`;
  const keys = new Set(targets.map((t) => key(t.schema, t.table)));
  const indeg = new Map<string, number>([...keys].map((k) => [k, 0]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!keys.has(e.from) || !keys.has(e.to) || e.from === e.to) continue;
    // e.from (child) depends on e.to (parent): parent first.
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
    indeg.set(e.from, (indeg.get(e.from) ?? 0) + 1);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([k]) => k);
  const order: string[] = [];
  while (queue.length > 0) {
    const k = queue.shift()!;
    order.push(k);
    for (const m of adj.get(k) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 1) - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  if (order.length !== keys.size) return targets; // cycle — keep discovery order
  const byKey = new Map(targets.map((t) => [key(t.schema, t.table), t]));
  return order.map((k) => byKey.get(k)!);
}

/** Build a `.sql` dump: header + DDL + multi-row INSERTs + views last. */
export async function exportDump(opts: DumpOptions): Promise<DumpResult> {
  const { database, includeSchema, includeData, onProgress } = opts;
  let targets = opts.targets ?? [];
  if (targets.length === 0) {
    const schemas = await listSchemas();
    targets = [];
    for (const s of schemas) {
      if (!s.can_usage) continue;
      const tables = await listTables(s.name).catch(() => []);
      for (const t of tables) {
        if (t.can_select) targets.push({ schema: t.schema, table: t.name, kind: t.kind });
      }
    }
  }
  const tables = targets.filter((t) => t.kind !== "view" && t.kind !== "materialized_view");
  const views = targets.filter((t) => t.kind === "view" || t.kind === "materialized_view");

  // Parents-first for data safety (best effort; cycles keep discovery order).
  let ordered = tables;
  try {
    const er = await getErModel();
    ordered = topoSort(
      tables,
      er.relations.map((r) => ({
        from: `${r.source_schema}.${r.source_table}`,
        to: `${r.target_schema}.${r.target_table}`,
      })),
    );
  } catch {
    /* ER unavailable — keep discovery order */
  }

  const parts: string[] = [
    `-- PostiExplorer SQL dump — database "${database}"`,
    `-- Generated ${new Date().toISOString()} (schema=${includeSchema ? "yes" : "no"}, data=${includeData ? "yes" : "no"})`,
    `-- Restore: open in the Query tab or via Restore, or run with psql -f.`,
    includeData ? "BEGIN;" : "",
  ];
  let rowCount = 0;
  let tableCount = 0;

  const emit = async (t: DumpTarget) => {
    const label = `${t.schema}.${t.table}`;
    if (includeSchema) {
      onProgress?.(`DDL ${label}…`);
      const { ddl } = await getTableDdl(t.schema, t.table);
      parts.push(`\n-- ── ${label} (${t.kind}) ──`);
      parts.push(ddl.trim().replace(/;?\s*$/, ";"));
    }
    if (includeData && t.kind !== "view" && t.kind !== "materialized_view" && t.kind !== "foreign_table") {
      onProgress?.(`Data ${label}…`);
      const first = await getTableData(t.schema, t.table, 1, 0).catch(() => null);
      if (!first || first.total === 0) return;
      const total = Math.min(first.total, DUMP_MAX_ROWS);
      const columns = first.columns;
      const all: unknown[][] = [];
      for (let off = 0; off < total; off += DATA_PAGE) {
        const page = await getTableData(t.schema, t.table, Math.min(DATA_PAGE, total - off), off);
        all.push(...page.rows);
        if (page.rows.length === 0) break;
      }
      parts.push(`\n-- ── data: ${label} (${all.length} rows) ──`);
      parts.push(...buildInserts(t.schema, t.table, columns, all));
      rowCount += all.length;
    }
    tableCount++;
  };

  for (const t of ordered) await emit(t);
  for (const t of views) await emit(t);

  if (includeData) parts.push("\nCOMMIT;");
  const sql = parts.filter((p) => p !== "").join("\n") + "\n";
  return { sql, tableCount, rowCount, statementCount: splitBatch(sql).length };
}

export interface RestoreResult {
  statements: number;
  batches: number;
  executionMs: number;
}

/** Restore a `.sql` file in ≤100-statement batches with global error indexes. */
export async function restoreDump(sql: string, onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const stmts = splitBatch(sql);
  if (stmts.length === 0) throw new Error("empty dump (no statements found)");
  let executionMs = 0;
  let batches = 0;
  for (let i = 0; i < stmts.length; i += RESTORE_BATCH_SIZE) {
    const chunk = stmts.slice(i, i + RESTORE_BATCH_SIZE);
    onProgress?.(Math.min(i + chunk.length, stmts.length), stmts.length);
    try {
      const res = await executeSqlBatch(chunk.join(";\n") + ";");
      executionMs += res.execution_ms;
      batches++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = /statement (\d+) failed: ([\s\S]*)/.exec(msg);
      if (m) {
        throw new Error(`statement ${Number(m[1]) + i} failed: ${m[2]}`);
      }
      throw e;
    }
  }
  return { statements: stmts.length, batches, executionMs };
}

/** Single-table `DDL + INSERTs` export (used by the Data tab SQL button). */
export async function exportTableSql(schema: string, table: string, includeData: boolean): Promise<{ sql: string; rows: number }> {
  const { ddl } = await getTableDdl(schema, table);
  const parts = [`-- PostiExplorer table dump — ${schema}.${table}`, `-- Generated ${new Date().toISOString()}`, ddl.trim().replace(/;?\s*$/, ";")];
  let rows = 0;
  // Views and similar relations are read-only: DDL only, no INSERTs.
  if (includeData) {
    const first = await getTableData(schema, table, 1, 0).catch(() => null);
    if (first && first.editable && first.total > 0) {
      const total = Math.min(first.total, DUMP_MAX_ROWS);
      const all: unknown[][] = [];
      for (let off = 0; off < total; off += DATA_PAGE) {
        const page = await getTableData(schema, table, Math.min(DATA_PAGE, total - off), off);
        all.push(...page.rows);
        if (page.rows.length === 0) break;
      }
      parts.push(...buildInserts(schema, table, first.columns, all));
      rows = all.length;
    }
  }
  return { sql: parts.join("\n") + "\n", rows };
}
