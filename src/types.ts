export type SslMode = "disable" | "prefer" | "require";

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode: SslMode;
}

export interface TestConnectionResult {
  ok: boolean;
  latency_ms: number;
  version?: string;
  error?: string;
}

export interface DatabaseEntry {
  name: string;
  size_pretty: string;
  owner: string;
}

export interface SchemaEntry {
  name: string;
  table_count: number;
}

export interface TableEntry {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view" | "foreign_table";
  rows_estimate: number;
  size_pretty: string;
}

export interface ColumnEntry {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary: boolean;
}

export interface TableDataResult {
  columns: string[];
  column_types: string[];
  rows: unknown[][];
  total: number;
  limit: number;
  offset: number;
  execution_ms: number;
  ctids: string[];
  editable: boolean;
  primary_keys: string[];
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  execution_ms: number;
  command: string;
  notice?: string;
}

export interface ServerInfo {
  version: string;
  uptime: string;
  database: string;
  size_pretty: string;
  table_count: number;
  connection_count: number;
  max_connections: number;
}

export type MainTab = "data" | "structure" | "query" | "info" | "er";

export interface ErRelation {
  constraint_name: string;
  source_schema: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
}

export interface ErTable {
  schema: string;
  name: string;
  kind: string;
  rows_estimate: number;
  size_pretty: string;
  columns: ColumnEntry[];
}

export interface ErModel {
  tables: ErTable[];
  relations: ErRelation[];
}

export interface ErDetailOptions {
  showTypes: boolean;
  showNullable: boolean;
  showDefaults: boolean;
  showRowCounts: boolean;
  showViews: boolean;
  showIsolated: boolean;
  showRelationLabels: boolean;
  colorBySchema: boolean;
}

// ── Extension points for future features (keep stable API) ──
// Future modules should implement these interfaces:
// - FunctionsExplorer, TriggersExplorer, ExtensionsManager,
//   RolesManager, ExplainAnalyzer, ImportExport, ERDiagram
export interface FutureModule {
  id: string;
  label: string;
  enabled: boolean;
}
