import type {
  ColumnEntry,
  ConnectionProfile,
  DatabaseEntry,
  QueryResult,
  SchemaEntry,
  ServerInfo,
  TableDataResult,
  TableEntry,
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
};

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
};

export const mock = {
  async testConnection(_p: ConnectionProfile): Promise<TestConnectionResult> {
    await delay(350);
    return { ok: true, latency_ms: 18, version: "PostgreSQL 16.4 (mock)" };
  },
  async listDatabases(): Promise<DatabaseEntry[]> {
    await delay(200);
    return [
      { name: "demo_db", size_pretty: "42 MB", owner: "postgres" },
      { name: "analytics", size_pretty: "128 MB", owner: "postgres" },
      { name: "postgres", size_pretty: "8 MB", owner: "postgres" },
    ];
  },
  async listSchemas(): Promise<SchemaEntry[]> {
    await delay(150);
    return [
      { name: "public", table_count: 3 },
      { name: "auth", table_count: 2 },
      { name: "billing", table_count: 1 },
    ];
  },
  async listTables(schema: string): Promise<TableEntry[]> {
    await delay(150);
    if (schema === "public")
      return [
        { schema, name: "users", kind: "table", rows_estimate: 12480, size_pretty: "4.2 MB" },
        { schema, name: "orders", kind: "table", rows_estimate: 88410, size_pretty: "18.6 MB" },
        { schema, name: "products", kind: "table", rows_estimate: 320, size_pretty: "256 kB" },
        { schema, name: "order_summary", kind: "view", rows_estimate: 0, size_pretty: "—" },
      ];
    if (schema === "auth")
      return [
        { schema, name: "sessions", kind: "table", rows_estimate: 2100, size_pretty: "1.1 MB" },
        { schema, name: "api_keys", kind: "table", rows_estimate: 84, size_pretty: "64 kB" },
      ];
    return [{ schema, name: "invoices", kind: "table", rows_estimate: 5120, size_pretty: "2.4 MB" }];
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
    let rows = [...(MOCK_ROWS[table] ?? MOCK_ROWS["users"])];
    const cols = (MOCK_COLUMNS[table] ?? MOCK_COLUMNS["users"]).map((c) => c.name);
    const types = (MOCK_COLUMNS[table] ?? MOCK_COLUMNS["users"]).map((c) => c.data_type);
    if (orderBy) {
      const idx = cols.indexOf(orderBy);
      if (idx >= 0) {
        rows.sort((a, b) => {
          const av = String(a[idx]);
          const bv = String(b[idx]);
          return orderDir === "DESC" ? (av < bv ? 1 : -1) : av > bv ? 1 : -1;
        });
      }
    }
    // inflate to 87 rows to show pagination
    const base = [...rows];
    while (rows.length < 87) rows.push(...base);
    rows = rows.slice(0, 87);
    const page = rows.slice(offset, offset + limit);
    return { columns: cols, column_types: types, rows: page, total: rows.length, limit, offset, execution_ms: 12 };
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
};
