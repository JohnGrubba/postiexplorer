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
}

#[derive(Debug, Serialize)]
pub struct SchemaEntry {
    pub name: String,
    pub table_count: i64,
}

#[derive(Debug, Serialize)]
pub struct TableEntry {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub rows_estimate: i64,
    pub size_pretty: String,
}

#[derive(Debug, Serialize)]
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
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub execution_ms: u64,
    pub command: String,
    pub notice: Option<String>,
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
