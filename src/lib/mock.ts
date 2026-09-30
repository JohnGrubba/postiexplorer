import type {
  BatchQueryResult,
  ColumnEntry,
  ConnectionProfile,
  DatabaseEntry,
  ErModel,
  NewColumnDef,
  QueryResult,
  SchemaEntry,
  SchemaPrivileges,
  ServerInfo,
  TableDataResult,
  TableEntry,
  TablePrivileges,
  TestConnectionResult,
} from "../types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let currentDb = "demo_db";

export function setDatabase(db: string) {
  currentDb = db;
}

export const MOCK_PROFILE: ConnectionProfile = {
  id: "demo",
  name: "Local Demo",
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "demo_db",
  sslmode: "prefer",
};

const MOCK_COLUMNS: Record<string, ColumnEntry[]> = {
  users: [
    { name: "id", data_type: "uuid", is_nullable: false, default_value: "gen_random_uuid()", is_primary: true },
    { name: "email", data_type: "text", is_nullable: false, default_value: null, is_primary: false },
    { name: "display_name", data_type: "text", is_nullable: true, default_value: null, is_primary: false },
    { name: "plan", data_type: "text", is_nullable: false, default_value: "'free'", is_primary: false },
    { name: "created_at", data_type: "timestamptz", is_nullable: false, default_value: "now()", is_primary: false },
  ],
  orders: [
    { name: "id", data_type: "bigint", is_nullable: false, default_value: null, is_primary: true },
    { name: "user_id", data_type: "uuid", is_nullable: false, default_value: null, is_primary: false },
    { name: "amount_cents", data_type: "integer", is_nullable: false, default_value: "0", is_primary: false },
    { name: "status", data_type: "text", is_nullable: false, default_value: "'pending'", is_primary: false },
    { name: "created_at", data_type: "timestamptz", is_nullable: false, default_value: "now()", is_primary: false },
  ],
  products: [
    { name: "sku", data_type: "text", is_nullable: false, default_value: null, is_primary: true },
    { name: "title", data_type: "text", is_nullable: false, default_value: null, is_primary: false },
    { name: "price_cents", data_type: "integer", is_nullable: false, default_value: "0", is_primary: false },
    { name: "in_stock", data_type: "boolean", is_nullable: false, default_value: "true", is_primary: false },
  ],
  sessions: [
    { name: "id", data_type: "uuid", is_nullable: false, default_value: "gen_random_uuid()", is_primary: true },
    { name: "user_id", data_type: "uuid", is_nullable: true, default_value: null, is_primary: false },
    { name: "created_at", data_type: "timestamptz", is_nullable: true, default_value: "now()", is_primary: false },
  ],
  api_keys: [
    { name: "id", data_type: "uuid", is_nullable: false, default_value: "gen_random_uuid()", is_primary: true },
    { name: "label", data_type: "text", is_nullable: false, default_value: null, is_primary: false },
    { name: "created_at", data_type: "timestamptz", is_nullable: true, default_value: "now()", is_primary: false },
  ],
  invoices: [
    { name: "id", data_type: "bigint", is_nullable: false, default_value: null, is_primary: true },
    { name: "total_cents", data_type: "integer", is_nullable: false, default_value: "0", is_primary: false },
  ],
  order_summary: [
    { name: "email", data_type: "text", is_nullable: true, default_value: null, is_primary: false },
    { name: "orders", data_type: "bigint", is_nullable: true, default_value: null, is_primary: false },
  ],
};

function columnsFor(table: string): ColumnEntry[] {
  return MOCK_COLUMNS[table] ?? MOCK_COLUMNS["users"];
}

function ctidFor(index: number): string {
  return `(0,${index + 1})`;
}

function ctidToIndex(ctid: string): number {
  const m = /^\((\d+),(\d+)\)$/.exec(ctid.trim());
  if (!m) throw new Error(`invalid row id: ${ctid}`);
  // Mock stores all rows in a single block; the tuple number is the 1-based index.
  if (m[1] !== "0") throw new Error(`invalid row id: ${ctid}`);
  return Number(m[2]) - 1;
}

/** Evaluate a column's DEFAULT expression into a mock value (dev-mode only). */
function mockDefault(col: ColumnEntry): unknown {
  const d = (col.default_value ?? "").trim();
  if (d.length >= 2 && d.startsWith("'") && d.endsWith("'")) return d.slice(1, -1).replace(/''/g, "'");
  if (d === "true") return true;
  if (d === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(d)) return Number(d);
  if (/^now\(\)$/i.test(d)) return new Date().toISOString().slice(0, 16).replace("T", " ");
  if (/^gen_random_uuid\(\)$/i.test(d)) return `mock-${Math.random().toString(36).slice(2, 8)}`;
  return null;
}

const MOCK_ROWS: Record<string, unknown[][]> = {
  users: [
    ["9b1a…01", "vitalik@eth.io", "vitalik", "pro", "2026-09-01 12:00"],
    ["9b1a…02", "satoshi@btc.io", "satoshi", "free", "2026-09-02 09:14"],
    ["9b1a…03", "ada@cardano.io", "ada.lovelace", "pro", "2026-09-03 18:22"],
    ["9b1a…04", "sol@solana.io", "toly", "free", "2026-09-04 11:05"],
    ["9b1a…05", "lens@polygon.io", "stani", "team", "2026-09-05 14:41"],
  ],
  orders: [
    [1001, "9b1a…01", 4999, "paid", "2026-09-10 10:00"],
    [1002, "9b1a…02", 1299, "pending", "2026-09-11 12:30"],
    [1003, "9b1a…03", 8999, "paid", "2026-09-12 08:15"],
    [1004, "9b1a…01", 2499, "refunded", "2026-09-13 16:44"],
  ],
  products: [
    ["SKU-001", "Neon Ledger", 2999, true],
    ["SKU-002", "Zero-Knowledge Hoodie", 7999, true],
    ["SKU-003", "Gasless Mug", 1499, false],
  ],
  sessions: [
    ["aa…01", "9b1a…01", "2026-09-12 08:00"],
    ["aa…02", "9b1a…02", "2026-09-12 09:00"],
  ],
  api_keys: [["kk…01", "ci-runner", "2026-09-01 08:00"]],
  invoices: [
    [5001, 4999],
    [5002, 1299],
  ],
  order_summary: [
    ["vitalik@eth.io", 2],
    ["satoshi@btc.io", 1],
  ],
};

const VIEW_TABLES = new Set(["order_summary"]);

/** Minimal top-level `;` splitter for mock batches (quotes/comments/dollar quotes). */
function splitMockStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") cur += sql[i++];
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      cur += "/*";
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          cur += "/*";
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          cur += "*/";
          i += 2;
        } else cur += sql[i++];
      }
      continue;
    }
    if (c === "'") {
      cur += c;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      cur += c;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            cur += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const delim = m[0];
        cur += delim;
        i += delim.length;
        const end = sql.indexOf(delim, i);
        if (end === -1) {
          cur += sql.slice(i);
          i = n;
        } else {
          cur += sql.slice(i, end + delim.length);
          i = end + delim.length;
        }
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === ";") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur);
  return out;
}

/** True when a mock statement holds nothing but whitespace/comments/`;`. */
function isMockEmpty(s: string): boolean {
  let t = s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  t = t.replace(/;/g, "").trim();
  return t === "";
}

export const mock = {
  async testConnection(_p: ConnectionProfile): Promise<TestConnectionResult> {
    await delay(350);
    return { ok: true, latency_ms: 18, version: "PostgreSQL 16.4 (mock)" };
  },
  async listDatabases(): Promise<DatabaseEntry[]> {
    await delay(200);
    return [
      { name: "demo_db", size_pretty: "42 MB", owner: "postgres", can_connect: true },
      { name: "analytics", size_pretty: "128 MB", owner: "postgres", can_connect: true },
      { name: "postgres", size_pretty: "8 MB", owner: "postgres", can_connect: true },
    ];
  },
  async listSchemas(): Promise<SchemaEntry[]> {
    await delay(150);
    return [
      { name: "public", table_count: 3, can_usage: true, can_create: true },
      { name: "auth", table_count: 2, can_usage: true, can_create: true },
      { name: "billing", table_count: 1, can_usage: true, can_create: true },
    ];
  },
  async listTables(schema: string): Promise<TableEntry[]> {
    await delay(150);
    if (schema === "public")
      return [
        { schema, name: "users", kind: "table", rows_estimate: 12480, size_pretty: "4.2 MB", can_select: true },
        { schema, name: "orders", kind: "table", rows_estimate: 88410, size_pretty: "18.6 MB", can_select: true },
        { schema, name: "products", kind: "table", rows_estimate: 320, size_pretty: "256 kB", can_select: true },
        { schema, name: "order_summary", kind: "view", rows_estimate: 0, size_pretty: "—", can_select: true },
      ];
    if (schema === "auth")
      return [
        { schema, name: "sessions", kind: "table", rows_estimate: 2100, size_pretty: "1.1 MB", can_select: true },
        { schema, name: "api_keys", kind: "table", rows_estimate: 84, size_pretty: "64 kB", can_select: true },
      ];
    return [{ schema, name: "invoices", kind: "table", rows_estimate: 5120, size_pretty: "2.4 MB", can_select: true }];
  },
  async getColumns(_schema: string, table: string): Promise<ColumnEntry[]> {
    await delay(120);
    return MOCK_COLUMNS[table] ?? MOCK_COLUMNS["users"];
  },
  async getTableData(
    _schema: string,
    table: string,
    limit: number,
    offset: number,
    orderBy?: string,
    orderDir?: string,
  ): Promise<TableDataResult> {
    await delay(180);
    const cols = columnsFor(table);
    const names = cols.map((c) => c.name);
    const types = cols.map((c) => c.data_type);
    const editable = !VIEW_TABLES.has(table);
    const primary_keys = cols.filter((c) => c.is_primary).map((c) => c.name);
    // Work on indices so ctids stay stable under sorting/paging.
    let indices = (MOCK_ROWS[table] ?? []).map((_, i) => i);
    if (orderBy) {
      const idx = names.indexOf(orderBy);
      if (idx >= 0) {
        indices.sort((a, b) => {
          const av = String((MOCK_ROWS[table] ?? [])[a][idx]);
          const bv = String((MOCK_ROWS[table] ?? [])[b][idx]);
          return orderDir === "DESC" ? (av < bv ? 1 : -1) : av > bv ? 1 : -1;
        });
      }
    }
    const total = indices.length;
    const pageIdx = indices.slice(offset, offset + limit);
    const store = MOCK_ROWS[table] ?? [];
    return {
      columns: names,
      column_types: types,
      rows: pageIdx.map((i) => [...store[i]]),
      total,
      limit,
      offset,
      execution_ms: 12,
      ctids: editable ? pageIdx.map(ctidFor) : [],
      editable,
      primary_keys,
      can_select: true,
      can_insert: editable,
      can_update: editable,
      can_delete: editable,
    };
  },
  async executeSql(sql: string): Promise<QueryResult> {
    await delay(220);
    const lowered = sql.trim().toLowerCase();
    if (lowered.startsWith("select")) {
      return {
        columns: ["id", "email", "plan"],
        rows: [
          ["9b1a…01", "vitalik@eth.io", "pro"],
          ["9b1a…02", "satoshi@btc.io", "free"],
        ],
        row_count: 2,
        execution_ms: 9,
        command: "SELECT",
      };
    }
    return { columns: [], rows: [], row_count: 0, execution_ms: 6, command: "OK", notice: "Mock execution — connect to a live database for real results." };
  },
  async executeSqlBatch(sql: string): Promise<BatchQueryResult> {
    const t0 = Date.now();
    // Quote-aware split on top-level `;` (mirrors the backend splitter for
    // the common cases: quotes, comments, dollar quotes).
    const parts = splitMockStatements(sql).filter((s) => !isMockEmpty(s));
    if (parts.length === 0) throw new Error("empty query");
    if (parts.length > 100) throw new Error("too many statements (max 100 per batch)");
    const results: QueryResult[] = [];
    for (const part of parts) {
      results.push(await mock.executeSql(part));
    }
    return { results, execution_ms: Date.now() - t0 };
  },
  async importRows(_schema: string, table: string, columns: string[], rows: unknown[][]): Promise<number> {
    await delay(120);
    if (VIEW_TABLES.has(table)) throw new Error("this view is read-only");
    if (columns.length === 0) throw new Error("no columns provided");
    if (rows.length === 0) throw new Error("no rows provided");
    if (rows.length > 1000) throw new Error("too many rows per batch (max 1000 — split the import)");
    const cols = columnsFor(table);
    const store = (MOCK_ROWS[table] ??= []);
    for (const r of rows) {
      if (r.length !== columns.length) throw new Error(`row has ${r.length} values, expected ${columns.length}`);
      const full = cols.map((c) => {
        const idx = columns.findIndex((name) => name.toLowerCase() === c.name.toLowerCase());
        if (idx >= 0) {
          const v = r[idx];
          // Empty mock cells behave like the backend: quoted literals cast
          // on insert; empty string stays an empty string unless the caller
          // passed null for NULL.
          return v as unknown;
        }
        return c.default_value != null ? mockDefault(c) : null;
      });
      store.push(full);
    }
    return rows.length;
  },
  async getServerInfo(): Promise<ServerInfo> {
    await delay(150);
    return {
      version: "PostgreSQL 16.4 on x86_64 (mock)",
      uptime: "3 days 04:12",
      database: currentDb,
      size_pretty: "42 MB",
      table_count: 6,
      connection_count: 7,
      max_connections: 100,
    };
  },
  async getErModel(): Promise<ErModel> {
    await delay(250);
    const tables: ErModel["tables"] = [
      { schema: "public", name: "users", kind: "table", rows_estimate: 12480, size_pretty: "4.2 MB", columns: MOCK_COLUMNS["users"] },
      { schema: "public", name: "orders", kind: "table", rows_estimate: 88410, size_pretty: "18.6 MB", columns: MOCK_COLUMNS["orders"] },
      { schema: "public", name: "products", kind: "table", rows_estimate: 320, size_pretty: "256 kB", columns: MOCK_COLUMNS["products"] },
      { schema: "public", name: "order_summary", kind: "view", rows_estimate: 0, size_pretty: "—", columns: MOCK_COLUMNS["order_summary"] },
      { schema: "auth", name: "sessions", kind: "table", rows_estimate: 2100, size_pretty: "1.1 MB", columns: MOCK_COLUMNS["sessions"] },
      { schema: "auth", name: "api_keys", kind: "table", rows_estimate: 84, size_pretty: "64 kB", columns: MOCK_COLUMNS["api_keys"] },
      { schema: "billing", name: "invoices", kind: "table", rows_estimate: 5120, size_pretty: "2.4 MB", columns: MOCK_COLUMNS["invoices"] },
    ];
    return {
      tables,
      relations: [
        {
          constraint_name: "orders_user_id_fkey",
          source_schema: "public",
          source_table: "orders",
          source_column: "user_id",
          target_schema: "public",
          target_table: "users",
          target_column: "id",
        },
        {
          constraint_name: "sessions_user_id_fkey",
          source_schema: "auth",
          source_table: "sessions",
          source_column: "user_id",
          target_schema: "public",
          target_table: "users",
          target_column: "id",
        },
      ],
    };
  },
  async insertRow(_schema: string, table: string, values: Record<string, unknown>): Promise<number> {
    await delay(120);
    if (VIEW_TABLES.has(table)) throw new Error("this view is read-only");
    const cols = columnsFor(table);
    if (!MOCK_ROWS[table]) MOCK_ROWS[table] = [];
    MOCK_ROWS[table].push(
      cols.map((c) => (c.name in values ? (values[c.name] as unknown) : c.default_value != null ? mockDefault(c) : null)),
    );
    return 1;
  },
  async updateRow(
    _schema: string,
    table: string,
    ctid: string,
    patch: Record<string, unknown>,
    defaults: string[] = [],
  ): Promise<number> {
    await delay(120);
    if (VIEW_TABLES.has(table)) throw new Error("this view is read-only");
    const store = MOCK_ROWS[table];
    if (!store) throw new Error(`table "${table}" not found`);
    const idx = ctidToIndex(ctid);
    const row = store[idx];
    if (!row) throw new Error("row no longer exists (it may have been updated or deleted) — please refresh");
    const cols = columnsFor(table);
    for (const [k, v] of Object.entries(patch)) {
      const ci = cols.findIndex((c) => c.name === k);
      if (ci < 0) throw new Error(`unknown column: ${k}`);
      row[ci] = v as unknown;
    }
    for (const k of defaults) {
      const col = cols.find((c) => c.name === k);
      if (!col) throw new Error(`unknown column: ${k}`);
      row[cols.indexOf(col)] = mockDefault(col);
    }
    return 1;
  },
  async deleteRows(_schema: string, table: string, ctids: string[]): Promise<number> {
    await delay(120);
    if (VIEW_TABLES.has(table)) throw new Error("this view is read-only");
    const store = MOCK_ROWS[table];
    if (!store) throw new Error(`table "${table}" not found`);
    const idxs = ctids.map(ctidToIndex).sort((a, b) => b - a);
    let n = 0;
    for (const i of idxs) {
      if (i >= 0 && i < store.length) {
        store.splice(i, 1);
        n++;
      }
    }
    return n;
  },
  async getTablePrivileges(_schema: string, table: string): Promise<TablePrivileges> {
    await delay(80);
    const editable = !VIEW_TABLES.has(table);
    return {
      current_user: "postgres",
      is_superuser: true,
      is_owner: true,
      select: true,
      insert: editable,
      update: editable,
      delete: editable,
      truncate: editable,
      references: true,
      trigger: editable,
      can_alter: editable,
      can_drop: editable,
    };
  },
  async getSchemaPrivileges(_schema: string): Promise<SchemaPrivileges> {
    await delay(80);
    return { current_user: "postgres", is_superuser: true, is_owner: true, usage: true, create: true };
  },
  async createTable(_schema: string, table: string, columns: NewColumnDef[]): Promise<number> {
    await delay(120);
    if (!table.trim()) throw new Error("table name is required");
    if (columns.length === 0) throw new Error("at least one column is required");
    if (MOCK_COLUMNS[table]) throw new Error(`table "${table}" already exists (mock)`);
    MOCK_COLUMNS[table] = columns.map((c) => ({
      name: c.name,
      data_type: c.data_type,
      is_nullable: c.is_nullable,
      default_value: c.default_value,
      is_primary: c.is_primary,
    }));
    MOCK_ROWS[table] = [];
    return 1;
  },
  async dropTable(_schema: string, table: string): Promise<number> {
    await delay(120);
    delete MOCK_COLUMNS[table];
    delete MOCK_ROWS[table];
    return 1;
  },
  async addColumn(_schema: string, table: string, column: NewColumnDef): Promise<number> {
    await delay(120);
    if (VIEW_TABLES.has(table)) throw new Error("this view is read-only");
    const cols = columnsFor(table);
    if (cols.some((c) => c.name === column.name)) throw new Error(`column "${column.name}" already exists`);
    cols.push({
      name: column.name,
      data_type: column.data_type,
      is_nullable: column.is_nullable,
      default_value: column.default_value,
      is_primary: column.is_primary,
    });
    MOCK_COLUMNS[table] = cols;
    for (const row of MOCK_ROWS[table] ?? []) row.push(null);
    return 1;
  },
  async dropColumn(_schema: string, table: string, column: string): Promise<number> {
    await delay(120);
    if (VIEW_TABLES.has(table)) throw new Error("this view is read-only");
    const cols = columnsFor(table);
    const idx = cols.findIndex((c) => c.name === column);
    if (idx < 0) throw new Error(`column "${column}" not found`);
    cols.splice(idx, 1);
    for (const row of MOCK_ROWS[table] ?? []) row.splice(idx, 1);
    return 1;
  },
  async renameColumn(_schema: string, table: string, oldName: string, newName: string): Promise<number> {
    await delay(120);
    const cols = columnsFor(table);
    const col = cols.find((c) => c.name === oldName);
    if (!col) throw new Error(`column "${oldName}" not found`);
    if (cols.some((c) => c.name === newName)) throw new Error(`column "${newName}" already exists`);
    col.name = newName;
    return 1;
  },
  async alterColumnType(_schema: string, table: string, column: string, newType: string): Promise<number> {
    await delay(120);
    const col = columnsFor(table).find((c) => c.name === column);
    if (!col) throw new Error(`column "${column}" not found`);
    col.data_type = newType;
    return 1;
  },
  async setColumnNullable(_schema: string, table: string, column: string, nullable: boolean): Promise<number> {
    await delay(120);
    const col = columnsFor(table).find((c) => c.name === column);
    if (!col) throw new Error(`column "${column}" not found`);
    col.is_nullable = nullable;
    return 1;
  },
  async setColumnDefault(_schema: string, table: string, column: string, defaultValue: string | null): Promise<number> {
    await delay(120);
    const col = columnsFor(table).find((c) => c.name === column);
    if (!col) throw new Error(`column "${column}" not found`);
    col.default_value = defaultValue;
    return 1;
  },
};
