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
    // Empty database = "choose after connecting" → land on the `postgres`
    // maintenance DB; the frontend then offers the database picker.
    let db = if p.database.trim().is_empty() { "postgres" } else { &p.database };
    format!(
        "host={} port={} user={} password={} dbname={} connect_timeout=8",
        p.host,
        p.port,
        escape(&p.user),
        escape(&p.password),
        escape(db),
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
/// Identifiers are always double-quoted with `"` escaped, so any non-empty
/// name without a NUL byte is safe — this must stay permissive so tables
/// with mixed-case, spaces or other legal characters remain editable.
fn ident_ok(s: &str) -> bool {
    !s.is_empty() && !s.contains('\0')
}

fn quote_ident(s: &str) -> Result<String, String> {
    if !ident_ok(s) {
        return Err(format!("unsafe identifier: {s}"));
    }
    Ok(format!("\"{}\"", s.replace('"', "\"\"")))
}

/// Quote a string as a SQL literal (`'` escaped by doubling).
fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Render a frontend JSON value as a SQL literal for INSERT/UPDATE.
/// Strings are quoted (PostgreSQL casts `'123'` to int, `'true'` to bool,
/// `'...'` to date/json/bytea automatically); NULL stays NULL.
fn json_to_literal(v: &serde_json::Value) -> String {
    use serde_json::Value;
    match v {
        Value::Null => "NULL".to_string(),
        Value::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => quote_literal(s),
        Value::Array(_) | Value::Object(_) => quote_literal(&v.to_string()),
    }
}

/// ctid text looks like `(0,1)` — validate strictly before interpolating.
fn validate_ctid(s: &str) -> Result<(), String> {
    let inner = s.strip_prefix('(').and_then(|r| r.strip_suffix(')'));
    match inner {
        Some(pair) => {
            let mut parts = pair.split(',');
            let ok = match (parts.next(), parts.next(), parts.next()) {
                (Some(a), Some(b), None) => !a.is_empty() && !b.is_empty() && a.bytes().all(|c| c.is_ascii_digit()) && b.bytes().all(|c| c.is_ascii_digit()),
                _ => false,
            };
            if ok {
                Ok(())
            } else {
                Err(format!("invalid row id: {s}"))
            }
        }
        None => Err(format!("invalid row id: {s}")),
    }
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

async fn fetch_relkind(client: &Client, schema: &str, table: &str) -> Result<String, String> {
    let row = client
        .query_opt(
            "SELECT c.relkind::text FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    row.map(|r| r.get(0)).ok_or_else(|| format!("table \"{schema}\".\"{table}\" not found"))
}

async fn fetch_primary_keys(client: &Client, schema: &str, table: &str) -> Result<Vec<String>, String> {
    let rows = client
        .query(
            "SELECT a.attname FROM pg_index i
             JOIN pg_class t ON t.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
             WHERE n.nspname = $1 AND t.relname = $2 AND i.indisprimary
             ORDER BY a.attnum",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    Ok(rows.into_iter().map(|r| r.get(0)).collect())
}

async fn fetch_column_defs(client: &Client, schema: &str, table: &str) -> Result<(Vec<String>, Vec<String>), String> {
    let rows = client
        .query(
            "SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    Ok((rows.iter().map(|r| r.get(0)).collect(), rows.iter().map(|r| r.get(1)).collect()))
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

    let relkind = fetch_relkind(&client, schema, table).await?;
    // Only heap relations carry a stable ctid we can target for UPDATE/DELETE.
    let mut editable = matches!(relkind.as_str(), "r" | "p" | "f");
    let primary_keys = fetch_primary_keys(&client, schema, table).await.unwrap_or_default();

    let total: i64 = client
        .query_one(&format!("SELECT COUNT(*) FROM {qs}.{qt}"), &[])
        .await
        .map_err(pg_err)?
        .get(0);

    let mut order_sql = String::new();
    if let Some(col) = order_by.filter(|c| !c.is_empty()) {
        let qc = quote_ident(&col)?;
        let dir = if order_dir.as_deref() == Some("DESC") { "DESC" } else { "ASC" };
        order_sql.push_str(&format!(" ORDER BY {qc} {dir}"));
    }

    let base = format!("SELECT * FROM {qs}.{qt}{order_sql} LIMIT {limit} OFFSET {offset}");

    // Fetch ctid alongside the page so every row can be addressed for
    // UPDATE/DELETE even when the table has no primary key.
    if editable {
        let sql_ctid = format!("SELECT *, ctid::text AS \"__postiexplorer_ctid\" FROM {qs}.{qt}{order_sql} LIMIT {limit} OFFSET {offset}");
        let t0 = Instant::now();
        match client.query(&sql_ctid, &[]).await {
            Ok(rows) => {
                let ms = t0.elapsed().as_millis() as u64;
                if rows.is_empty() {
                    let (columns, column_types) = fetch_column_defs(&client, schema, table).await?;
                    return Ok(TableDataResult {
                        columns,
                        column_types,
                        rows: vec![],
                        total,
                        limit,
                        offset,
                        execution_ms: ms,
                        ctids: vec![],
                        editable,
                        primary_keys,
                    });
                }
                let ncols = rows[0].len();
                let ctid_idx = ncols - 1;
                let columns: Vec<String> = rows[0].columns().iter().take(ctid_idx).map(|c| c.name().to_string()).collect();
                let column_types: Vec<String> = rows[0].columns().iter().take(ctid_idx).map(|c| c.type_().name().to_string()).collect();
                let mut data = Vec::with_capacity(rows.len());
                let mut ctids = Vec::with_capacity(rows.len());
                for r in &rows {
                    data.push((0..ctid_idx).map(|i| cell_to_json(r, i)).collect());
                    let ctid: String = r.try_get(ctid_idx).map_err(pg_err)?;
                    ctids.push(ctid);
                }
                // Re-time cheaply: measure a no-op? Use actual query time instead.
                return Ok(TableDataResult {
                    columns,
                    column_types,
                    rows: data,
                    total,
                    limit,
                    offset,
                    execution_ms: ms,
                    ctids,
                    editable,
                    primary_keys,
                });
            }
            Err(_) => {
                // No addressable ctid (e.g. partitioned parent, foreign
                // table without ctid): fall through to a plain read-only page.
                editable = false;
            }
        }
    }

    let t0 = Instant::now();
    let rows = client.query(&base, &[]).await.map_err(pg_err)?;
    let ms = t0.elapsed().as_millis() as u64;
    if rows.is_empty() {
        let (columns, column_types) = fetch_column_defs(&client, schema, table).await?;
        return Ok(TableDataResult {
            columns,
            column_types,
            rows: vec![],
            total,
            limit,
            offset,
            execution_ms: ms,
            ctids: vec![],
            editable,
            primary_keys,
        });
    }
    let (columns, column_types, data) = rows_to_json(&rows);
    let n = data.len();
    Ok(TableDataResult {
        columns,
        column_types,
        rows: data,
        total,
        limit,
        offset,
        execution_ms: ms,
        ctids: vec![String::new(); n],
        editable,
        primary_keys,
    })
}

pub async fn op_insert_row(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    values: std::collections::HashMap<String, serde_json::Value>,
) -> Result<u64, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    if values.is_empty() {
        // Every column left on Default → let PostgreSQL fill the whole row.
        let sql = format!("INSERT INTO {qs}.{qt} DEFAULT VALUES");
        let handle = client_for(state, connection_id)?;
        let client = handle.lock().await;
        return client.execute(sql.as_str(), &[]).await.map_err(pg_err).map(|n| n as u64);
    }
    let mut cols = Vec::with_capacity(values.len());
    let mut lits = Vec::with_capacity(values.len());
    // Sort for deterministic SQL (helps tests / logs).
    let mut keys: Vec<_> = values.keys().collect();
    keys.sort();
    for k in keys {
        cols.push(quote_ident(k)?);
        lits.push(json_to_literal(&values[k]));
    }
    let sql = format!("INSERT INTO {qs}.{qt} ({}) VALUES ({})", cols.join(", "), lits.join(", "));
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client.execute(sql.as_str(), &[]).await.map_err(pg_err).map(|n| n as u64)
}

pub async fn op_update_row(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    ctid: String,
    patch: std::collections::HashMap<String, serde_json::Value>,
    defaults: Vec<String>,
) -> Result<u64, String> {
    if patch.is_empty() && defaults.is_empty() {
        return Err("no changes provided".to_string());
    }
    validate_ctid(&ctid)?;
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let mut sets = Vec::with_capacity(patch.len() + defaults.len());
    let mut keys: Vec<_> = patch.keys().collect();
    keys.sort();
    for k in keys {
        let qc = quote_ident(k)?;
        sets.push(format!("{qc} = {}", json_to_literal(&patch[k])));
    }
    let mut defaults = defaults;
    defaults.sort();
    for k in &defaults {
        let qc = quote_ident(k)?;
        sets.push(format!("{qc} = DEFAULT"));
    }
    let sql = format!("UPDATE {qs}.{qt} SET {} WHERE ctid = {}", sets.join(", "), quote_literal(&ctid));
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let n = client.execute(sql.as_str(), &[]).await.map_err(pg_err)? as u64;
    if n == 0 {
        return Err("row no longer exists (it may have been updated or deleted) — please refresh".to_string());
    }
    Ok(n)
}

pub async fn op_delete_rows(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    ctids: Vec<String>,
) -> Result<u64, String> {
    if ctids.is_empty() {
        return Err("no rows selected".to_string());
    }
    if ctids.len() > 1000 {
        return Err("too many rows selected (max 1000)".to_string());
    }
    for c in &ctids {
        validate_ctid(c)?;
    }
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let list = ctids.iter().map(|c| quote_literal(c)).collect::<Vec<_>>().join(", ");
    let sql = format!("DELETE FROM {qs}.{qt} WHERE ctid IN ({list})");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client.execute(sql.as_str(), &[]).await.map_err(pg_err).map(|n| n as u64)
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
