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

use std::{collections::HashMap, sync::Arc, sync::Mutex, time::Instant};

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
    let db = if p.database.trim().is_empty() {
        "postgres"
    } else {
        &p.database
    };
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
                (Some(a), Some(b), None) => {
                    !a.is_empty()
                        && !b.is_empty()
                        && a.bytes().all(|c| c.is_ascii_digit())
                        && b.bytes().all(|c| c.is_ascii_digit())
                }
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
                return v
                    .map(|b| json!(format!("\\x{}", hex(&b))))
                    .unwrap_or(Value::Null);
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
    let columns: Vec<String> = rows[0]
        .columns()
        .iter()
        .map(|c| c.name().to_string())
        .collect();
    let types: Vec<String> = rows[0]
        .columns()
        .iter()
        .map(|c| c.type_().name().to_string())
        .collect();
    let data = rows
        .iter()
        .map(|r| (0..r.len()).map(|i| cell_to_json(r, i)).collect())
        .collect();
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

pub async fn open_connection(
    state: &DbState,
    profile: ConnectionProfile,
) -> Result<String, String> {
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

fn client_for(
    state: &DbState,
    connection_id: &str,
) -> Result<Arc<tokio::sync::Mutex<Client>>, String> {
    state
        .connections
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned()
        .ok_or_else(|| "not connected (stale connection id)".to_string())
}

pub async fn op_list_databases(
    state: &DbState,
    connection_id: &str,
) -> Result<Vec<DatabaseEntry>, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let rows = client
        .query(
            "SELECT d.datname, pg_size_pretty(pg_database_size(d.datname)), pg_get_userbyid(d.datdba),
                    has_database_privilege(d.datname, 'CONNECT')
             FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname",
            &[],
        )
        .await
        .map_err(pg_err)?;
    Ok(rows
        .into_iter()
        .map(|r| DatabaseEntry {
            name: r.get(0),
            size_pretty: r
                .get::<_, Option<String>>(1)
                .unwrap_or_else(|| "—".to_string()),
            owner: r.get::<_, Option<String>>(2).unwrap_or_default(),
            can_connect: r.get::<_, Option<bool>>(3).unwrap_or(false),
        })
        .collect())
}

pub async fn op_list_schemas(
    state: &DbState,
    connection_id: &str,
) -> Result<Vec<SchemaEntry>, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let rows = client
        .query(
            "SELECT n.nspname, COUNT(c.oid),
                    has_schema_privilege(n.nspname, 'USAGE'),
                    has_schema_privilege(n.nspname, 'CREATE')
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
            can_usage: r.get::<_, Option<bool>>(2).unwrap_or(false),
            can_create: r.get::<_, Option<bool>>(3).unwrap_or(false),
        })
        .collect())
}

pub async fn op_list_tables(
    state: &DbState,
    connection_id: &str,
    schema: &str,
) -> Result<Vec<TableEntry>, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let rows = client
        .query(
            "SELECT c.relname,
                    CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view'
                         WHEN 'm' THEN 'materialized_view' WHEN 'f' THEN 'foreign_table' ELSE 'table' END,
                    COALESCE(c.reltuples::bigint, 0),
                    pg_size_pretty(pg_total_relation_size(c.oid)),
                    has_table_privilege(c.oid, 'SELECT')
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
            // pg_total_relation_size can return NULL for a relation dropped
            // concurrently (parallel tests / other sessions) — never let a
            // missing size crash the whole tree.
            size_pretty: r
                .get::<_, Option<String>>(3)
                .unwrap_or_else(|| "—".to_string()),
            can_select: r.get::<_, Option<bool>>(4).unwrap_or(false),
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
    row.map(|r| r.get(0))
        .ok_or_else(|| format!("table \"{schema}\".\"{table}\" not found"))
}

async fn fetch_primary_keys(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<String>, String> {
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

async fn fetch_column_defs(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<(Vec<String>, Vec<String>), String> {
    let rows = client
        .query(
            "SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    Ok((
        rows.iter().map(|r| r.get(0)).collect(),
        rows.iter().map(|r| r.get(1)).collect(),
    ))
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
    let primary_keys = fetch_primary_keys(&client, schema, table)
        .await
        .unwrap_or_default();

    // Per-privilege gating so the frontend can disable buttons up-front
    // instead of surfacing "permission denied" after the fact.
    let priv_row = client
        .query_one(
            "SELECT has_table_privilege(format('%I.%I', $1::text, $2::text), 'SELECT'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'INSERT'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'UPDATE'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'DELETE')",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    let can_select: bool = priv_row.get(0);
    let can_insert: bool = priv_row.get(1);
    let can_update: bool = priv_row.get(2);
    let can_delete: bool = priv_row.get(3);

    let total: i64 = client
        .query_one(&format!("SELECT COUNT(*) FROM {qs}.{qt}"), &[])
        .await
        .map_err(pg_err)?
        .get(0);

    let mut order_sql = String::new();
    if let Some(col) = order_by.filter(|c| !c.is_empty()) {
        let qc = quote_ident(&col)?;
        let dir = if order_dir.as_deref() == Some("DESC") {
            "DESC"
        } else {
            "ASC"
        };
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
                        primary_keys: primary_keys.clone(),
                        can_select,
                        can_insert,
                        can_update,
                        can_delete,
                    });
                }
                let ncols = rows[0].len();
                let ctid_idx = ncols - 1;
                let columns: Vec<String> = rows[0]
                    .columns()
                    .iter()
                    .take(ctid_idx)
                    .map(|c| c.name().to_string())
                    .collect();
                let column_types: Vec<String> = rows[0]
                    .columns()
                    .iter()
                    .take(ctid_idx)
                    .map(|c| c.type_().name().to_string())
                    .collect();
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
                    primary_keys: primary_keys.clone(),
                    can_select,
                    can_insert,
                    can_update,
                    can_delete,
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
            primary_keys: primary_keys.clone(),
            can_select,
            can_insert,
            can_update,
            can_delete,
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
        can_select,
        can_insert,
        can_update,
        can_delete,
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
        return client
            .execute(sql.as_str(), &[])
            .await
            .map_err(pg_err)
            .map(|n| n as u64);
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
    let sql = format!(
        "INSERT INTO {qs}.{qt} ({}) VALUES ({})",
        cols.join(", "),
        lits.join(", ")
    );
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
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
    let sql = format!(
        "UPDATE {qs}.{qt} SET {} WHERE ctid = {}",
        sets.join(", "),
        quote_literal(&ctid)
    );
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let n = client.execute(sql.as_str(), &[]).await.map_err(pg_err)? as u64;
    if n == 0 {
        return Err(
            "row no longer exists (it may have been updated or deleted) — please refresh"
                .to_string(),
        );
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
    let list = ctids
        .iter()
        .map(|c| quote_literal(c))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("DELETE FROM {qs}.{qt} WHERE ctid IN ({list})");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_execute_sql(
    state: &DbState,
    connection_id: &str,
    sql: &str,
) -> Result<QueryResult, String> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err("empty query".to_string());
    }
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    execute_single(&client, sql).await
}

async fn execute_single(client: &Client, sql: &str) -> Result<QueryResult, String> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err("empty query".to_string());
    }
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
            command: if command.is_empty() {
                "OK".into()
            } else {
                command
            },
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
        command: if command.is_empty() {
            "SELECT".into()
        } else {
            command
        },
        notice: None,
    })
}

// ── multi-statement batches ────────────────────────────────────
// The SQL editor sends the whole buffer; PostgreSQL's extended protocol
// (`prepare`) only accepts a single statement, so split here and run each
// part sequentially in autocommit (same semantics as psql without an
// explicit transaction). The splitter is quote/comment aware so `;`
// inside string literals, quoted identifiers, dollar-quoted function
// bodies and comments never split.

/// Split SQL text on top-level `;`, ignoring semicolons inside
/// single-quoted strings (incl. `E'...'` escapes), double-quoted
/// identifiers, line/block comments and `$tag$...$tag$` dollar quotes.
/// Returns trimmed non-empty statements.
fn split_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut i = 0;
    let n = chars.len();
    while i < n {
        let c = chars[i];
        // Line comment `-- ...` (only outside literals — we are at top level here).
        if c == '-' && i + 1 < n && chars[i + 1] == '-' {
            cur.push('-');
            cur.push('-');
            let mut j = i + 2;
            while j < n && chars[j] != '\n' {
                cur.push(chars[j]);
                j += 1;
            }
            i = j;
            continue;
        }
        // Block comment `/* ... */` with nesting (PostgreSQL nests them).
        if c == '/' && i + 1 < n && chars[i + 1] == '*' {
            let mut depth = 1usize;
            cur.push(c);
            cur.push(chars[i + 1]);
            i += 2;
            while i < n && depth > 0 {
                if chars[i] == '/' && i + 1 < n && chars[i + 1] == '*' {
                    depth += 1;
                    cur.push('/');
                    cur.push('*');
                    i += 2;
                } else if chars[i] == '*' && i + 1 < n && chars[i + 1] == '/' {
                    depth -= 1;
                    cur.push('*');
                    cur.push('/');
                    i += 2;
                } else {
                    cur.push(chars[i]);
                    i += 1;
                }
            }
            continue;
        }
        // Single-quoted string. Detect `E'...'` prefix for backslash escapes:
        // the last non-space char before the quote is E/e preceded by a
        // non-identifier char (or start).
        if c == '\'' {
            let trimmed = cur.trim_end();
            let esc = trimmed
                .strip_suffix(|ch: char| ch == 'E' || ch == 'e')
                .map(|rest| {
                    rest.chars()
                        .last()
                        .map(|p| !p.is_alphanumeric() && p != '_')
                        .unwrap_or(true)
                })
                .unwrap_or(false);
            cur.push(c);
            i += 1;
            while i < n {
                let d = chars[i];
                cur.push(d);
                if esc && d == '\\' && i + 1 < n {
                    cur.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                if d == '\'' {
                    if i + 1 < n && chars[i + 1] == '\'' {
                        cur.push('\'');
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // Double-quoted identifier with `""` escape.
        if c == '"' {
            cur.push(c);
            i += 1;
            while i < n {
                cur.push(chars[i]);
                if chars[i] == '"' {
                    if i + 1 < n && chars[i + 1] == '"' {
                        cur.push('"');
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // Dollar-quoted string `$tag$...$tag$` (tag empty or identifier-like).
        if c == '$' {
            if let Some((tag, delim_len)) = parse_dollar_open(&chars, i) {
                let close: String = format!("${tag}$");
                cur.push_str(&close);
                i += delim_len;
                while i < n {
                    if matches_close(&chars, i, &close) {
                        for ch in close.chars() {
                            cur.push(ch);
                        }
                        i += close.chars().count();
                        break;
                    }
                    cur.push(chars[i]);
                    i += 1;
                }
                continue;
            }
            cur.push(c);
            i += 1;
            continue;
        }
        if c == ';' {
            let stmt = cur.trim().to_string();
            if !stmt.is_empty() {
                out.push(stmt);
            }
            cur.clear();
            i += 1;
            continue;
        }
        cur.push(c);
        i += 1;
    }
    let tail = cur.trim().to_string();
    if !tail.is_empty() {
        out.push(tail);
    }
    out
}

/// Parse a `$tag$` opening delimiter at `chars[i]`.
/// Returns the tag and its char length (`$$` → ("", 2)).
fn parse_dollar_open(chars: &[char], i: usize) -> Option<(String, usize)> {
    if chars[i] != '$' {
        return None;
    }
    let mut j = i + 1;
    let mut tag = String::new();
    while j < chars.len() && chars[j] != '$' {
        let ch = chars[j];
        if ch.is_alphanumeric() || ch == '_' {
            // Tags must not start with a digit (`$1` is a parameter, not a quote).
            if tag.is_empty() && ch.is_ascii_digit() {
                return None;
            }
            if tag.len() >= 32 {
                return None;
            }
            tag.push(ch);
            j += 1;
        } else {
            return None;
        }
    }
    if j >= chars.len() || chars[j] != '$' {
        return None;
    }
    // `$1` / `$12` (bare parameter) has no second `$` — handled above by
    // the digit check; `$tag` without closing `$` is not a quote.
    let delim_len = j - i + 1;
    Some((tag, delim_len))
}

fn matches_close(chars: &[char], i: usize, close: &str) -> bool {
    let need: Vec<char> = close.chars().collect();
    if i + need.len() > chars.len() {
        return false;
    }
    chars[i..i + need.len()].iter().collect::<String>() == close
}

/// True when a statement holds nothing but whitespace and comments.
fn statement_is_empty(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    let n = chars.len();
    while i < n {
        let c = chars[i];
        if c.is_whitespace() || c == ';' {
            i += 1;
            continue;
        }
        if c == '-' && i + 1 < n && chars[i + 1] == '-' {
            while i < n && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && i + 1 < n && chars[i + 1] == '*' {
            let mut depth = 1usize;
            i += 2;
            while i < n && depth > 0 {
                if chars[i] == '/' && i + 1 < n && chars[i + 1] == '*' {
                    depth += 1;
                    i += 2;
                } else if chars[i] == '*' && i + 1 < n && chars[i + 1] == '/' {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        return false;
    }
    true
}

pub async fn op_execute_sql_batch(
    state: &DbState,
    connection_id: &str,
    sql: &str,
) -> Result<BatchQueryResult, String> {
    if sql.trim().is_empty() {
        return Err("empty query".to_string());
    }
    let stmts: Vec<String> = split_statements(sql)
        .into_iter()
        .filter(|s| !statement_is_empty(s))
        .collect();
    if stmts.is_empty() {
        return Err("empty query".to_string());
    }
    if stmts.len() > 100 {
        return Err("too many statements (max 100 per batch)".to_string());
    }
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let t0 = Instant::now();
    let mut results = Vec::with_capacity(stmts.len());
    for (idx, stmt) in stmts.iter().enumerate() {
        match execute_single(&client, stmt).await {
            Ok(r) => results.push(r),
            Err(e) => return Err(format!("statement {} failed: {}", idx + 1, e)),
        }
    }
    Ok(BatchQueryResult {
        results,
        execution_ms: t0.elapsed().as_millis() as u64,
    })
}

// ── CSV import: multi-row INSERT from parsed frontend rows ─────
// The frontend parses CSV (quotes, BOM, newlines) and sends strings;
// PostgreSQL casts quoted literals (`'123'` → int, `'true'` → bool)
// automatically, so no per-type conversion is needed here. Identifiers
// are quoted, values rendered as literals — an injection attempt in a
// cell lands as a string literal, never as SQL.

pub async fn op_import_rows(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
) -> Result<u64, String> {
    if columns.is_empty() {
        return Err("no columns provided".to_string());
    }
    if columns.len() > 100 {
        return Err("too many columns (max 100)".to_string());
    }
    if rows.is_empty() {
        return Err("no rows provided".to_string());
    }
    if rows.len() > 1000 {
        return Err("too many rows per batch (max 1000 — split the import)".to_string());
    }
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let mut seen = std::collections::HashSet::new();
    let mut qcols = Vec::with_capacity(columns.len());
    for c in &columns {
        let t = c.trim();
        if t.is_empty() {
            return Err("column name is required".to_string());
        }
        if !seen.insert(t.to_lowercase()) {
            return Err(format!("duplicate column: {t}"));
        }
        qcols.push(quote_ident(t)?);
    }
    for (ri, r) in rows.iter().enumerate() {
        if r.len() != columns.len() {
            return Err(format!(
                "row {} has {} values, expected {}",
                ri + 1,
                r.len(),
                columns.len()
            ));
        }
    }
    let mut tuples = Vec::with_capacity(rows.len());
    for r in &rows {
        let lits: Vec<String> = r.iter().map(json_to_literal).collect();
        tuples.push(format!("({})", lits.join(", ")));
    }
    let sql = format!(
        "INSERT INTO {qs}.{qt} ({}) VALUES {}",
        qcols.join(", "),
        tuples.join(", ")
    );
    // Guard against absurdly large statements (10 MB cap).
    if sql.len() > 10_000_000 {
        return Err("import batch too large (max ~10 MB per batch — split the import)".to_string());
    }
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_server_info(state: &DbState, connection_id: &str) -> Result<ServerInfo, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let version: String = client
        .query_one("SELECT version()", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let db: String = client
        .query_one("SELECT current_database()", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let size: String = client
        .query_one(
            "SELECT pg_size_pretty(pg_database_size(current_database()))",
            &[],
        )
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
    let maxc: String = client
        .query_one("SHOW max_connections", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let up: String = client
        .query_one("SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint::text, '0')", &[])
        .await
        .map_err(pg_err)?
        .get(0);
    let secs: i64 = up.parse().unwrap_or(0);
    Ok(ServerInfo {
        version,
        uptime: format!(
            "{}d {:02}:{:02}",
            secs / 86400,
            (secs % 86400) / 3600,
            (secs % 3600) / 60
        ),
        database: db,
        size_pretty: size,
        table_count: tables,
        connection_count: conns,
        max_connections: maxc.parse().unwrap_or(100),
    })
}

// ── ER model ───────────────────────────────────────────────────
// Returns every user table/view (+ its columns) and every foreign-key
// edge in one round-trip batch, so the frontend can render an ER diagram
// without N+1 queries.

pub async fn op_get_er_model(state: &DbState, connection_id: &str) -> Result<ErModel, String> {
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;

    // 1) tables across all user schemas
    let table_rows = client
        .query(
            "SELECT n.nspname,
                    c.relname,
                    CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view'
                         WHEN 'm' THEN 'materialized_view' WHEN 'f' THEN 'foreign_table' ELSE 'table' END,
                    COALESCE(c.reltuples::bigint, 0),
                    pg_size_pretty(pg_total_relation_size(c.oid))
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname NOT IN ('pg_toast','pg_catalog','information_schema')
               AND c.relkind IN ('r','v','m','f','p')
             ORDER BY n.nspname, c.relname",
            &[],
        )
        .await
        .map_err(pg_err)?;

    // 2) columns for all those tables in one query (PK flag via pg_constraint)
    let col_rows = client
        .query(
            "SELECT col.table_schema, col.table_name, col.column_name, col.data_type,
                    (col.is_nullable = 'YES'), col.column_default,
                    EXISTS (SELECT 1 FROM pg_constraint con
                            JOIN pg_class rel ON rel.oid = con.conrelid
                            JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                            JOIN unnest(con.conkey) AS k(attnum) ON true
                            JOIN pg_attribute attr ON attr.attrelid = rel.oid AND attr.attnum = k.attnum
                            WHERE con.contype = 'p'
                              AND ns.nspname = col.table_schema
                              AND rel.relname = col.table_name
                              AND attr.attname = col.column_name)
             FROM information_schema.columns col
             WHERE col.table_schema NOT IN ('pg_toast','pg_catalog','information_schema')
             ORDER BY col.table_schema, col.table_name, col.ordinal_position",
            &[],
        )
        .await
        .map_err(pg_err)?;

    use std::collections::HashMap;
    let mut cols_by_table: HashMap<(String, String), Vec<ColumnEntry>> = HashMap::new();
    for r in col_rows {
        let schema: String = r.get(0);
        let table: String = r.get(1);
        let entry = ColumnEntry {
            name: r.get(2),
            data_type: r.get(3),
            is_nullable: r.get(4),
            default_value: r.get(5),
            is_primary: r.get(6),
        };
        cols_by_table
            .entry((schema, table))
            .or_default()
            .push(entry);
    }

    let mut tables = Vec::with_capacity(table_rows.len());
    for r in table_rows {
        let schema: String = r.get(0);
        let name: String = r.get(1);
        let kind: String = r.get(2);
        let rows_estimate: i64 = r.get(3);
        let size_pretty: String = r
            .get::<_, Option<String>>(4)
            .unwrap_or_else(|| "—".to_string());
        let columns = cols_by_table
            .remove(&(schema.clone(), name.clone()))
            .unwrap_or_default();
        tables.push(ErTable {
            schema,
            name,
            kind,
            rows_estimate,
            size_pretty,
            columns,
        });
    }

    // 3) foreign-key edges (one row per column pair, supports composite FKs)
    let fk_rows = client
        .query(
            "SELECT con.conname,
                    ns.nspname, cl.relname, a.attname,
                    tns.nspname, tcl.relname, ta.attname
             FROM pg_constraint con
             JOIN pg_class cl ON cl.oid = con.conrelid
             JOIN pg_namespace ns ON ns.oid = cl.relnamespace
             JOIN pg_class tcl ON tcl.oid = con.confrelid
             JOIN pg_namespace tns ON tns.oid = tcl.relnamespace
             JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
             JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
             JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
             JOIN pg_attribute ta ON ta.attrelid = tcl.oid AND ta.attnum = fk.attnum
             WHERE con.contype = 'f'
               AND ns.nspname NOT IN ('pg_toast','pg_catalog','information_schema')
               AND tns.nspname NOT IN ('pg_toast','pg_catalog','information_schema')
             ORDER BY ns.nspname, cl.relname, k.ord",
            &[],
        )
        .await
        .map_err(pg_err)?;

    let relations = fk_rows
        .into_iter()
        .map(|r| ErRelation {
            constraint_name: r.get(0),
            source_schema: r.get(1),
            source_table: r.get(2),
            source_column: r.get(3),
            target_schema: r.get(4),
            target_table: r.get(5),
            target_column: r.get(6),
        })
        .collect();

    Ok(ErModel { tables, relations })
}

// ── privileges: up-front gating so the UI disables what the user may not do ──

async fn fetch_whoami(client: &Client) -> Result<(String, bool), String> {
    let row = client
        .query_one(
            "SELECT current_user, COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)",
            &[],
        )
        .await
        .map_err(pg_err)?;
    Ok((row.get(0), row.get(1)))
}

pub async fn op_get_table_privileges(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
) -> Result<TablePrivileges, String> {
    if schema.is_empty() || table.is_empty() {
        return Err("schema and table are required".to_string());
    }
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    // Existence check first so has_table_privilege never errors on a missing rel.
    fetch_relkind(&client, schema, table).await?;
    let (current_user, is_superuser) = fetch_whoami(&client).await?;

    let priv_row = client
        .query_one(
            "SELECT has_table_privilege(format('%I.%I', $1::text, $2::text), 'SELECT'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'INSERT'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'UPDATE'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'DELETE'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'TRUNCATE'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'REFERENCES'),
                    has_table_privilege(format('%I.%I', $1::text, $2::text), 'TRIGGER')",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    let (select, insert, update, delete, truncate, references, trigger): (
        bool,
        bool,
        bool,
        bool,
        bool,
        bool,
        bool,
    ) = (
        priv_row.get(0),
        priv_row.get(1),
        priv_row.get(2),
        priv_row.get(3),
        priv_row.get(4),
        priv_row.get(5),
        priv_row.get(6),
    );

    // Ownership via role membership (covers direct owner + member of owning role).
    let owner_row = client
        .query_one(
            "SELECT c.relowner::regrole::text, pg_has_role(current_user, c.relowner, 'MEMBER')
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2",
            &[&schema, &table],
        )
        .await
        .map_err(pg_err)?;
    let owner_name: String = owner_row.get(0);
    let is_member: bool = owner_row.get(1);
    let is_owner = is_member || owner_name == current_user;
    let can_alter = is_owner || is_superuser;
    Ok(TablePrivileges {
        current_user,
        is_superuser,
        is_owner,
        select,
        insert,
        update,
        delete,
        truncate,
        references,
        trigger,
        can_alter,
        can_drop: can_alter,
    })
}

pub async fn op_get_schema_privileges(
    state: &DbState,
    connection_id: &str,
    schema: &str,
) -> Result<SchemaPrivileges, String> {
    if schema.is_empty() {
        return Err("schema is required".to_string());
    }
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    let (current_user, is_superuser) = fetch_whoami(&client).await?;
    let priv_row = client
        .query_one(
            "SELECT has_schema_privilege($1, 'USAGE'), has_schema_privilege($1, 'CREATE')",
            &[&schema],
        )
        .await
        .map_err(pg_err)?;
    let usage: bool = priv_row.get(0);
    let create: bool = priv_row.get(1);
    let owner_row = client
        .query_opt(
            "SELECT nspowner::regrole::text, pg_has_role(current_user, nspowner, 'MEMBER')
             FROM pg_namespace WHERE nspname = $1",
            &[&schema],
        )
        .await
        .map_err(pg_err)?;
    let (is_owner, owner_name) = match owner_row {
        Some(r) => {
            let owner: String = r.get(0);
            let member: bool = r.get(1);
            (member || owner == current_user, owner)
        }
        None => (false, String::new()),
    };
    let _ = owner_name;
    Ok(SchemaPrivileges {
        current_user,
        is_superuser,
        is_owner,
        usage,
        create,
    })
}

// ── DDL: structure editing + table creation ──────────────────────
// Identifiers are always quoted via quote_ident. Type names and DEFAULT
// expressions are raw SQL fragments: they are validated to block statement
// chaining (`;`, NUL) — the Query tab already lets a privileged user run
// arbitrary SQL, so this is a guardrail against accidents, not a privilege
// boundary.

fn validate_column_type(t: &str) -> Result<String, String> {
    let trimmed = t.trim();
    if trimmed.is_empty() {
        return Err("column type is required".to_string());
    }
    if trimmed.len() > 100 {
        return Err("column type too long".to_string());
    }
    if trimmed.contains('\0') || trimmed.contains(';') {
        return Err(format!("unsafe column type: {t}"));
    }
    if trimmed.contains("--") || trimmed.contains("/*") {
        return Err(format!("unsafe column type: {t}"));
    }
    if trimmed.contains('\'') {
        return Err(format!("unsafe column type: {t}"));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || " _(),.[]\"".contains(c))
    {
        return Err(format!("unsafe column type: {t}"));
    }
    Ok(trimmed.to_string())
}

fn validate_default_expr(d: &str) -> Result<String, String> {
    let trimmed = d.trim();
    if trimmed.is_empty() {
        return Err("default expression is empty".to_string());
    }
    if trimmed.len() > 1000 {
        return Err("default expression too long".to_string());
    }
    if trimmed.contains('\0') || trimmed.contains(';') {
        return Err("unsafe default expression (statement chaining is not allowed)".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_table_name(t: &str) -> Result<(), String> {
    if t.trim().is_empty() {
        return Err("table name is required".to_string());
    }
    if t.len() > 63 {
        return Err("table name too long (max 63 chars)".to_string());
    }
    // Reuse identifier quoting as validation (rejects NUL / empty).
    quote_ident(t.trim()).map(|_| ())
}

fn column_sql(col: &NewColumnDef, inline_pk: bool) -> Result<String, String> {
    let qc = quote_ident(col.name.trim())?;
    if col.name.trim().is_empty() {
        return Err("column name is required".to_string());
    }
    let ty = validate_column_type(&col.data_type)?;
    let mut s = format!("{qc} {ty}");
    if !col.is_nullable {
        s.push_str(" NOT NULL");
    }
    if let Some(d) = col.default_value.as_deref() {
        let t = d.trim();
        if !t.is_empty() {
            s.push_str(&format!(" DEFAULT {}", validate_default_expr(t)?));
        }
    }
    if inline_pk && col.is_primary {
        s.push_str(" PRIMARY KEY");
    }
    Ok(s)
}

pub async fn op_create_table(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    columns: Vec<NewColumnDef>,
) -> Result<u64, String> {
    validate_table_name(table)?;
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table.trim())?;
    if columns.is_empty() {
        return Err("at least one column is required".to_string());
    }
    if columns.len() > 100 {
        return Err("too many columns (max 100)".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for c in &columns {
        let n = c.name.trim();
        if n.is_empty() {
            return Err("column name is required".to_string());
        }
        if !seen.insert(n.to_lowercase()) {
            return Err(format!("duplicate column name: {n}"));
        }
    }
    let pk_cols: Vec<String> = columns
        .iter()
        .filter(|c| c.is_primary)
        .map(|c| quote_ident(c.name.trim()))
        .collect::<Result<Vec<_>, _>>()?;
    // Inline single-column PK, table constraint otherwise (avoids duplicate syntax).
    let inline_pk = pk_cols.len() == 1;
    let mut defs = Vec::with_capacity(columns.len() + 1);
    for c in &columns {
        defs.push(column_sql(c, inline_pk)?);
    }
    if pk_cols.len() > 1 {
        defs.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
    }
    let sql = format!("CREATE TABLE {qs}.{qt} ({})", defs.join(", "));
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_drop_table(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
) -> Result<u64, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let sql = format!("DROP TABLE {qs}.{qt}");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_add_column(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    column: NewColumnDef,
) -> Result<u64, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let def = column_sql(&column, column.is_primary)?;
    let sql = format!("ALTER TABLE {qs}.{qt} ADD COLUMN {def}");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_drop_column(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<u64, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let qc = quote_ident(column)?;
    let sql = format!("ALTER TABLE {qs}.{qt} DROP COLUMN {qc}");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_rename_column(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    old_name: &str,
    new_name: &str,
) -> Result<u64, String> {
    if new_name.trim().is_empty() {
        return Err("new column name is required".to_string());
    }
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let qo = quote_ident(old_name)?;
    let qn = quote_ident(new_name.trim())?;
    let sql = format!("ALTER TABLE {qs}.{qt} RENAME COLUMN {qo} TO {qn}");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_alter_column_type(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    column: &str,
    new_type: &str,
) -> Result<u64, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let qc = quote_ident(column)?;
    let ty = validate_column_type(new_type)?;
    let sql = format!("ALTER TABLE {qs}.{qt} ALTER COLUMN {qc} TYPE {ty} USING {qc}::{ty}");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_set_column_nullable(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    column: &str,
    nullable: bool,
) -> Result<u64, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let qc = quote_ident(column)?;
    let action = if nullable {
        "DROP NOT NULL"
    } else {
        "SET NOT NULL"
    };
    let sql = format!("ALTER TABLE {qs}.{qt} ALTER COLUMN {qc} {action}");
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}

pub async fn op_set_column_default(
    state: &DbState,
    connection_id: &str,
    schema: &str,
    table: &str,
    column: &str,
    default_value: Option<String>,
) -> Result<u64, String> {
    let qs = quote_ident(schema)?;
    let qt = quote_ident(table)?;
    let qc = quote_ident(column)?;
    let sql = match default_value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(expr) => {
            let valid = validate_default_expr(expr)?;
            format!("ALTER TABLE {qs}.{qt} ALTER COLUMN {qc} SET DEFAULT {valid}")
        }
        None => format!("ALTER TABLE {qs}.{qt} ALTER COLUMN {qc} DROP DEFAULT"),
    };
    let handle = client_for(state, connection_id)?;
    let client = handle.lock().await;
    client
        .execute(sql.as_str(), &[])
        .await
        .map_err(pg_err)
        .map(|n| n as u64)
}
