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
import { mock } from "./mock";

function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  // Tauri v1 exposes __TAURI__, v2 exposes __TAURI_INTERNALS__.
  // Checking both is required — v1-only checks silently fall back to mock
  // inside the real desktop binary.
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// ── Public API. In browser (vite dev) it falls back to mock data,
//    inside Tauri it calls the Rust backend. Signatures stay identical. ──

let connectionId: string | null = null;
export function getConnectionId() {
  return connectionId;
}

export async function testConnection(profile: ConnectionProfile): Promise<TestConnectionResult> {
  if (!isTauri()) return mock.testConnection(profile);
  return invoke<TestConnectionResult>("test_connection", { profile });
}

export async function connect(profile: ConnectionProfile): Promise<string> {
  if (!isTauri()) {
    connectionId = "mock-connection";
    return connectionId;
  }
  connectionId = await invoke<string>("connect", { profile });
  return connectionId;
}

export async function disconnect(): Promise<void> {
  if (!isTauri()) {
    connectionId = null;
    return;
  }
  if (connectionId) await invoke("disconnect", { connectionId });
  connectionId = null;
}

export async function listDatabases(): Promise<DatabaseEntry[]> {
  if (!isTauri()) return mock.listDatabases();
  return invoke<DatabaseEntry[]>("list_databases", { connectionId });
}

export async function listSchemas(): Promise<SchemaEntry[]> {
  if (!isTauri()) return mock.listSchemas();
  return invoke<SchemaEntry[]>("list_schemas", { connectionId });
}

export async function listTables(schema: string): Promise<TableEntry[]> {
  if (!isTauri()) return mock.listTables(schema);
  return invoke<TableEntry[]>("list_tables", { connectionId, schema });
}

export async function getColumns(schema: string, table: string): Promise<ColumnEntry[]> {
  if (!isTauri()) return mock.getColumns(schema, table);
  return invoke<ColumnEntry[]>("get_columns", { connectionId, schema, table });
}

export async function getTableData(
  schema: string,
  table: string,
  limit: number,
  offset: number,
  orderBy?: string | null,
  orderDir?: string | null,
): Promise<TableDataResult> {
  if (!isTauri()) return mock.getTableData(schema, table, limit, offset, orderBy ?? undefined, orderDir ?? undefined);
  return invoke<TableDataResult>("get_table_data", {
    connectionId,
    schema,
    table,
    limit,
    offset,
    orderBy: orderBy ?? null,
    orderDir: orderDir ?? null,
  });
}

export async function executeSql(sql: string): Promise<QueryResult> {
  if (!isTauri()) return mock.executeSql(sql);
  return invoke<QueryResult>("execute_sql", { connectionId, sql });
}

export async function getServerInfo(): Promise<ServerInfo> {
  if (!isTauri()) return mock.getServerInfo();
  return invoke<ServerInfo>("get_server_info", { connectionId });
}

export { isTauri };
