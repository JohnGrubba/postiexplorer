//! Database layer — all PostgreSQL access lives here.
//!
//! Design: `DbState` holds live `tokio_postgres::Client`s keyed by connection id.
//! Every Tauri command in `main.rs` is a thin wrapper around these helpers,
//! so future features (functions, triggers, extensions, roles, EXPLAIN, …)
//! only need a new function here + a new `#[tauri::command]`.
//!
//! NOTE on TLS: v0.1 connects with `NoTls` for maximum portability of the
//! single-binary build (no OpenSSL bundling). `sslmode` is accepted and
//! validated; wiring `postgres-native-tls` / `postgres-openssl` later is a
//! ~15-line change inside `connect_client()` (search for TLS TODO).

use std::{collections::HashMap, sync::Mutex, sync::Arc, time::Instant};

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use tokio_postgres::{Client, NoTls, Row};
use uuid::Uuid;

use crate::models::*;

pub struct DbState {
    pub connections: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Client>>>>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

fn conn_string(p: &ConnectionProfile) -> String {
    format!(
        "host={} port={} user={} password={} dbname={} connect_timeout=8",
        p.host,
        p.port,
        escape(&p.user),
        escape(&p.password),
        escape(&p.database),
    )
}

fn escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Render a tokio-postgres error with its server-side fields.
/// `Error::to_string()` alone often yields just "db error" — the actionable
/// detail (severity, SQLSTATE code, message, hint) lives in `as_db_error()`.
fn pg_err(e: tokio_postgres::Error) -> String {
    if let Some(db) = e.as_db_error() {
        let mut s = format!("{} {}: {}", db.severity(), db.code().code(), db.message());
        if let Some(d) = db.detail() {
            if !d.is_empty() {
                s.push_str(&format!(" ({d})"));
            }
        }
        if let Some(h) = db.hint() {
            if !h.is_empty() {
                s.push_str(&format!(" [hint: {h}]"));
            }
        }
        return s;
    }
    format!("{e} ({e:?})")
}

fn connect_context(p: &ConnectionProfile) -> String {
    format!("{}:{}/{} as {}", p.host, p.port, p.database, p.user)
}

/// Only allow safe SQL identifiers (schema / table / column names).
fn ident_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 63 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn quote_ident(s: &str) -> Result<String, String> {
    if !ident_ok(s) {
        return Err(format!("unsafe identifier: {s}"));
    }
    Ok(format!("\"{}\"", s.replace('"', "\"\"")))
}

async fn connect_client(p: &ConnectionProfile) -> Result<Client, String> {
    // TODO(TLS): match on p.sslmode ("disable" | "prefer" | "require") and use
    //   postgres-native-tls / postgres-openssl connector for encrypted builds.
    let (client, connection) = tokio_postgres::connect(&conn_string(p), NoTls)
        .await
        .map_err(|e| format!("connect to {} failed: {}", connect_context(p), pg_err(e)))?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("postgres connection error: {e}");
        }
    });
    Ok(client)
}

// ── cell conversion ──────────────────────────────────────────────

fn cell_to_json(row: &Row, idx: usize) -> serde_json::Value {
    use serde_json::{json, Value};
    let col = &row.columns()[idx];
    let t = col.type_().name();
    macro_rules! opt {
        ($ty:ty) => {
            match row.try_get::<_, Option<$ty>>(idx) {
                Ok(Some(v)) => {
                    let s = serde_json::to_value(&v).unwrap_or(Value::Null);
                    return s;
                }
                Ok(None) => return Value::Null,
                Err(_) => {}
            }
        };
    }
    match t {
        "bool" => opt!(bool),
        "int2" => opt!(i16),
        "int4" => opt!(i32),
        "int8" => opt!(i64),
        "float4" => opt!(f32),
        "float8" => opt!(f64),
        "numeric" => {
            if let Ok(v) = row.try_get::<_, Option<String>>(idx) {
                return v.map(Value::String).unwrap_or(Value::Null);
            }
        }
        "text" | "varchar" | "bpchar" | "name" | "citext" => opt!(String),
        "uuid" => opt!(Uuid),
        "json" | "jsonb" => opt!(serde_json::Value),
        "bytea" => {
            if let Ok(v) = row.try_get::<_, Option<Vec<u8>>>(idx) {
                return v.map(|b| json!(format!("\\x{}", hex(&b)))).unwrap_or(Value::Null);
            }
        }
        "date" => opt!(NaiveDate),
        "time" | "timetz" => opt!(NaiveTime),
        "timestamp" => opt!(NaiveDateTime),
        "timestamptz" => opt!(DateTime<Utc>),
        _ => {}
    }
    if let Ok(v) = row.try_get::<_, Option<String>>(idx) {
        return v.map(Value::String).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<_, Option<i64>>(idx) {
        return v.map(|x| json!(x)).unwrap_or(Value::Null);
    }
    if let Ok(v) = row.try_get::<_, Option<f64>>(idx) {
        return v.map(|x| json!(x)).unwrap_or(Value::Null);
    }
    Value::Null
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn rows_to_json(rows: &[Row]) -> (Vec<String>, Vec<String>, Vec<Vec<serde_json::Value>>) {
    if rows.is_empty() {
        return (vec![], vec![], vec![]);
    }
    let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
    let types: Vec<String> = rows[0].columns().iter().map(|c| c.type_().name().to_string()).collect();
    let data = rows.iter().map(|r| (0..r.len()).map(|i| cell_to_json(r, i)).collect()).collect();
    (columns, types, data)
}

// ── public operations ────────────────────────────────────────────

pub async fn test_connection(profile: ConnectionProfile) -> TestConnectionResult {
    let t0 = Instant::now();
    match connect_client(&profile).await {
        Ok(client) => match client.query_one("SELECT version()", &[]).await {
            Ok(row) => {
                let version: String = row.get(0);
                TestConnectionResult {
                    ok: true,
                    latency_ms: t0.elapsed().as_millis() as u64,
                    version: Some(version),
                    error: None,
                }
            }
            Err(e) => TestConnectionResult {
                ok: false,
                latency_ms: t0.elapsed().as_millis() as u64,
                version: None,
                error: Some(pg_err(e)),
            },
        },
        Err(e) => TestConnectionResult {
            ok: false,
            latency_ms: t0.elapsed().as_millis() as u64,
            version: None,
            error: Some(e),
        },
    }
}

pub async fn open_connection(state: &DbState, profile: ConnectionProfile) -> Result<String, String> {
    let client = connect_client(&profile).await?;
    client.query_one("SELECT 1", &[]).await.map_err(pg_err)?;
    let id = Uuid::new_v4().to_string();
    state
        .connections
        .lock()
        .unwrap()
        .insert(id.clone(), Arc::new(tokio::sync::Mutex::new(client)));
    Ok(id)
}

pub fn close_connection(state: &DbState, connection_id: &str) {
    state.connections.lock().unwrap().remove(connection_id);
}

fn client_for(state: &DbState, connection_id: &str) -> Result<Arc<tokio::sync::Mutex<Client>>, String> {
    state
        .connections
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned()
        .ok_or_else(|| "not connected (stale connection id)".to_string())
}

pub async fn op_list_databases(state: &DbState, connection_id: &str) -> Result<Vec<DatabaseEntry>, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let rows = client
        .query(
            "SELECT d.datname, pg_size_pretty(pg_database_size(d.datname)), pg_get_userbyid(d.datdba)
             FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname",
            &[],
        )
        .await
        .map_err(pg_err)?;
    Ok(rows
        .into_iter()
        .map(|r| DatabaseEntry {
            name: r.get(0),
            size_pretty: r.get(1),
            owner: r.get(2),
        })
        .collect())
}

pub async fn op_list_schemas(state: &DbState, connection_id: &str) -> Result<Vec<SchemaEntry>, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let rows = client
        .query(
            "SELECT n.nspname, COUNT(c.oid)
             FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r','v','m','f','p')
             WHERE n.nspname NOT IN ('pg_toast','pg_catalog','information_schema')
             GROUP BY n.nspname ORDER BY n.nspname",
            &[],
        )
        .await
        .map_err(pg_err)?;
    Ok(rows
        .into_iter()
        .map(|r| SchemaEntry {
            name: r.get(0),
            table_count: r.get::<_, i64>(1),
        })
        .collect())
}

pub async fn op_list_tables(state: &DbState, connection_id: &str, schema: &str) -> Result<Vec<TableEntry>, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let rows = client
        .query(
            "SELECT c.relname,
                    CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view'
                         WHEN 'm' THEN 'materialized_view' WHEN 'f' THEN 'foreign_table' ELSE 'table' END,
                    COALESCE(c.reltuples::bigint, 0),
                    pg_size_pretty(pg_total_relation_size(c.oid))
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relkind IN ('r','v','m','f','p')
             ORDER BY c.relname",
            &[&schema],
        )
        .await
        .map_err(pg_err)?;
    Ok(rows
        .into_iter()
        .map(|r| TableEntry {
            schema: schema.to_string(),
            name: r.get(0),
            kind: r.get(1),
            rows_estimate: r.get(2),
            size_pretty: r.get(3),
        })
        .collect())
}

pub async fn op_get_columns(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnEntry>, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let rows = client
        .query(
            "SELECT col.column_name, col.data_type, (col.is_nullable = 'YES'),
                    col.column_default,
                    EXISTS (SELECT 1 FROM pg_constraint con
                            JOIN pg_class rel ON rel.oid = con.conrelid
                            JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                            JOIN unnest(con.conkey) AS k(attnum) ON true
                            JOIN pg_attribute attr ON attr.attrelid = rel.oid AND attr.attnum = k.attnum
                            WHERE con.contype = 'p' AND ns.nspname = $1 AND rel.relname = $2
                              AND attr.attname = col.column_name)
             FROM information_schema.columns col
             WHERE col.table_schema = $1 AND col.table_name = $2
             ORDER BY col.ordinal_position",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    Ok(rows
        .into_iter()
        .map(|r| ColumnEntry {
            name: r.get(0),
            data_type: r.get(1),
            is_nullable: r.get(2),
            default_value: r.get(3),
            is_primary: r.get(4),
        })
        .collect())
}

pub async fn op_get_table_data(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    limit: i64,
    offset: i64,
    order_by: Option<String>,
    order_dir: Option<String>,
) -> Result<TableDataResult, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let limit = limit.clamp(1, 1000);
    let offset = offset.max(0);
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;

    let total: i64 = client
        .query_one(&format!("SELECT COUNT(*) FROM {qs}.{qt}"), &[])
        .await
        .map_err(pg_err)?
        .get(0);

    let mut sql = format!("SELECT * FROM {qs}.{qt}");
    if let Some(col) = order_by.filter(|c| !c.is_empty()) {
        let qc = quote_ident(&col)?;
        let dir = if order_dir.as_deref() == Some("DESC") { "DESC" } else { "ASC" };
        sql.push_str(&format!(" ORDER BY {qc} {dir}"));
    }
    sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));

    let t0 = Instant::now();
    let rows = client.query(&sql, &[]).await.map_err(pg_err)?;
    let ms = t0.elapsed().as_millis() as u64;
    let (columns, column_types, data) = rows_to_json(&rows);
    Ok(TableDataResult {
        columns,
        column_types,
        rows: data,
        total,
        limit,
        offset,
        execution_ms: ms,
    })
}

pub async fn op_execute_sql(state: &DbState, connection_id: &str, sql: &str) -> Result<QueryResult, String> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err("empty query".to_string());
    }
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let t0 = Instant::now();
    let stmt = client.prepare(sql).await.map_err(pg_err)?;
    let command = sql.split_whitespace().next().unwrap_or("").to_uppercase();
    let ms_of = |t: Instant| t.elapsed().as_millis() as u64;

    if stmt.columns().is_empty() {
        let n = client.execute(sql, &[]).await.map_err(pg_err)?;
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: n as usize,
            execution_ms: ms_of(t0),
            command: if command.is_empty() { "OK".into() } else { command },
            notice: Some(format!("{n} rows affected")),
        });
    }
    let rows = client.query(sql, &[]).await.map_err(pg_err)?;
    let ms = ms_of(t0);
    let (columns, _t, data) = rows_to_json(&rows);
    Ok(QueryResult {
        row_count: data.len(),
        columns,
        rows: data,
        execution_ms: ms,
        command: if command.is_empty() { "SELECT".into() } else { command },
        notice: None,
    })
}

pub async fn op_server_info(state: &DbState, connection_id: &str) -> Result<ServerInfo, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let version: String = client.query_one("SELECT version()", &[]).await.map_err(pg_err)?.get(0);
    let db: String = client
        .query_one("SELECT current_database()", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let size: String = client
        .query_one("SELECT pg_size_pretty(pg_database_size(current_database()))", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let tables: i64 = client
        .query_one("SELECT COUNT(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let conns: i64 = client
        .query_one("SELECT COUNT(*) FROM pg_stat_activity", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let maxc: String = client.query_one("SHOW max_connections", &[]).await.map_err(pg_err)?.get(0);
    let up: String = client
        .query_one("SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint::text, '0')", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let secs: i64 = up.parse().unwrap_or(0);
    Ok(ServerInfo {
        version,
        uptime: format!("{}d {:02}:{:02}", secs / 86400, (secs % 86400) / 3600, (secs % 3600) / 60),
        database: db,
        size_pretty: size,
        table_count: tables,
        connection_count: conns,
        max_connections: maxc.parse().unwrap_or(100),
    })
}
