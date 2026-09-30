use serde::{Deserialize, Serialize};

/// Connection profile from the frontend. `id`/`name` are for UI bookkeeping,
/// `sslmode` is validated and reserved for the TLS upgrade (see db.rs).
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    pub sslmode: String,
}

#[derive(Debug, Serialize)]
pub struct TestConnectionResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DatabaseEntry {
    pub name: String,
    pub size_pretty: String,
    pub owner: String,
    pub can_connect: bool,
}

#[derive(Debug, Serialize)]
pub struct SchemaEntry {
    pub name: String,
    pub table_count: i64,
    pub can_usage: bool,
    pub can_create: bool,
}

#[derive(Debug, Serialize)]
pub struct TableEntry {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub rows_estimate: i64,
    pub size_pretty: String,
    pub can_select: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ColumnEntry {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary: bool,
}

#[derive(Debug, Serialize)]
pub struct TableDataResult {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub execution_ms: u64,
    pub ctids: Vec<String>,
    pub editable: bool,
    pub primary_keys: Vec<String>,
    pub can_select: bool,
    pub can_insert: bool,
    pub can_update: bool,
    pub can_delete: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub execution_ms: u64,
    pub command: String,
    pub notice: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BatchQueryResult {
    pub results: Vec<QueryResult>,
    pub execution_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct ServerInfo {
    pub version: String,
    pub uptime: String,
    pub database: String,
    pub size_pretty: String,
    pub table_count: i64,
    pub connection_count: i64,
    pub max_connections: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ErTable {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub rows_estimate: i64,
    pub size_pretty: String,
    pub columns: Vec<ColumnEntry>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ErRelation {
    pub constraint_name: String,
    pub source_schema: String,
    pub source_table: String,
    pub source_column: String,
    pub target_schema: String,
    pub target_table: String,
    pub target_column: String,
}

#[derive(Debug, Serialize)]
pub struct ErModel {
    pub tables: Vec<ErTable>,
    pub relations: Vec<ErRelation>,
}

#[derive(Debug, Serialize)]
pub struct TablePrivileges {
    pub current_user: String,
    pub is_superuser: bool,
    pub is_owner: bool,
    pub select: bool,
    pub insert: bool,
    pub update: bool,
    pub delete: bool,
    pub truncate: bool,
    pub references: bool,
    pub trigger: bool,
    pub can_alter: bool,
    pub can_drop: bool,
}

#[derive(Debug, Serialize)]
pub struct SchemaPrivileges {
    pub current_user: String,
    pub is_superuser: bool,
    pub is_owner: bool,
    pub usage: bool,
    pub create: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewColumnDef {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary: bool,
}

#[derive(Debug, Serialize)]
pub struct TableDdl {
    pub schema: String,
    pub table: String,
    /// `table` | `view` | `materialized_view` | `foreign_table` (mirrors TableEntry).
    pub kind: String,
    /// One or more `;`-terminated statements: CREATE + ALTERs + INDEXes,
    /// or `CREATE OR REPLACE VIEW …` for views.
    pub ddl: String,
}
