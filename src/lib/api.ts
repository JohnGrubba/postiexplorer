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
  TableDdl,
  TableEntry,
  TablePrivileges,
  TestConnectionResult,
} from "../types";
import { mock, setDatabase as setMockDatabase } from "./mock";

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

/** Empty `database` means "decide after connecting" — use the `postgres`
 *  maintenance DB for the initial connection. Applies to both Tauri and mock. */
function effectiveProfile(profile: ConnectionProfile): ConnectionProfile {
  if (profile.database.trim() !== "") return profile;
  return { ...profile, database: "postgres" };
}

export async function testConnection(profile: ConnectionProfile): Promise<TestConnectionResult> {
  const eff = effectiveProfile(profile);
  if (!isTauri()) return mock.testConnection(eff);
  return invoke<TestConnectionResult>("test_connection", { profile: eff });
}

export async function connect(profile: ConnectionProfile): Promise<string> {
  const eff = effectiveProfile(profile);
  if (!isTauri()) {
    setMockDatabase(eff.database);
    connectionId = "mock-connection";
    return connectionId;
  }
  connectionId = await invoke<string>("connect", { profile: eff });
  return connectionId;
}

export async function disconnect(id?: string): Promise<void> {
  const target = id ?? connectionId;
  if (!isTauri()) {
    if (target === connectionId) connectionId = null;
    return;
  }
  if (target) await invoke("disconnect", { connectionId: target });
  if (target === connectionId) connectionId = null;
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

export async function executeSqlBatch(sql: string): Promise<BatchQueryResult> {
  if (!isTauri()) return mock.executeSqlBatch(sql);
  return invoke<BatchQueryResult>("execute_sql_batch", { connectionId, sql });
}

export async function importRows(schema: string, table: string, columns: string[], rows: unknown[][]): Promise<number> {
  if (!isTauri()) return mock.importRows(schema, table, columns, rows);
  return invoke<number>("import_rows", { connectionId, schema, table, columns, rows });
}

export async function insertRow(schema: string, table: string, values: Record<string, unknown>): Promise<number> {
  if (!isTauri()) return mock.insertRow(schema, table, values);
  return invoke<number>("insert_row", { connectionId, schema, table, values });
}

export async function updateRow(
  schema: string,
  table: string,
  ctid: string,
  patch: Record<string, unknown>,
  defaults: string[] = [],
): Promise<number> {
  if (!isTauri()) return mock.updateRow(schema, table, ctid, patch, defaults);
  return invoke<number>("update_row", { connectionId, schema, table, ctid, patch, defaults });
}

export async function deleteRows(schema: string, table: string, ctids: string[]): Promise<number> {
  if (!isTauri()) return mock.deleteRows(schema, table, ctids);
  return invoke<number>("delete_rows", { connectionId, schema, table, ctids });
}

export async function getServerInfo(): Promise<ServerInfo> {
  if (!isTauri()) return mock.getServerInfo();
  return invoke<ServerInfo>("get_server_info", { connectionId });
}

export async function getErModel(): Promise<ErModel> {
  if (!isTauri()) return mock.getErModel();
  return invoke<ErModel>("get_er_model", { connectionId });
}

export async function getTablePrivileges(schema: string, table: string): Promise<TablePrivileges> {
  if (!isTauri()) return mock.getTablePrivileges(schema, table);
  return invoke<TablePrivileges>("get_table_privileges", { connectionId, schema, table });
}

export async function getSchemaPrivileges(schema: string): Promise<SchemaPrivileges> {
  if (!isTauri()) return mock.getSchemaPrivileges(schema);
  return invoke<SchemaPrivileges>("get_schema_privileges", { connectionId, schema });
}

export async function createTable(schema: string, table: string, columns: NewColumnDef[]): Promise<number> {
  if (!isTauri()) return mock.createTable(schema, table, columns);
  return invoke<number>("create_table", { connectionId, schema, table, columns });
}

export async function dropTable(schema: string, table: string): Promise<number> {
  if (!isTauri()) return mock.dropTable(schema, table);
  return invoke<number>("drop_table", { connectionId, schema, table });
}

export async function addColumn(schema: string, table: string, column: NewColumnDef): Promise<number> {
  if (!isTauri()) return mock.addColumn(schema, table, column);
  return invoke<number>("add_column", { connectionId, schema, table, column });
}

export async function dropColumn(schema: string, table: string, column: string): Promise<number> {
  if (!isTauri()) return mock.dropColumn(schema, table, column);
  return invoke<number>("drop_column", { connectionId, schema, table, column });
}

export async function renameColumn(schema: string, table: string, oldName: string, newName: string): Promise<number> {
  if (!isTauri()) return mock.renameColumn(schema, table, oldName, newName);
  return invoke<number>("rename_column", { connectionId, schema, table, oldName, newName });
}

export async function alterColumnType(schema: string, table: string, column: string, newType: string): Promise<number> {
  if (!isTauri()) return mock.alterColumnType(schema, table, column, newType);
  return invoke<number>("alter_column_type", { connectionId, schema, table, column, newType });
}

export async function setColumnNullable(
  schema: string,
  table: string,
  column: string,
  nullable: boolean,
): Promise<number> {
  if (!isTauri()) return mock.setColumnNullable(schema, table, column, nullable);
  return invoke<number>("set_column_nullable", { connectionId, schema, table, column, nullable });
}

export async function setColumnDefault(
  schema: string,
  table: string,
  column: string,
  defaultValue: string | null,
): Promise<number> {
  if (!isTauri()) return mock.setColumnDefault(schema, table, column, defaultValue);
  return invoke<number>("set_column_default", { connectionId, schema, table, column, defaultValue });
}

export async function getTableDdl(schema: string, table: string): Promise<TableDdl> {
  if (!isTauri()) return mock.getTableDdl(schema, table);
  return invoke<TableDdl>("get_table_ddl", { connectionId, schema, table });
}

export { isTauri };
