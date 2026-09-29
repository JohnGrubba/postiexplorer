//! Live-DB integration tests. Require a local PostgreSQL:
//!   docker run -d --name postiexplorer-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
//!   + seed.sql applied to demo_db.
//! Run: cargo test --test live_db
//! Env overrides: PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DB.

use postiexplorer::{db, models::ConnectionProfile, DbState};
use std::collections::HashMap;

fn profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "test".into(),
        name: "test".into(),
        host: std::env::var("PG_HOST").unwrap_or("localhost".into()),
        port: std::env::var("PG_PORT").unwrap_or("5432".into()).parse().unwrap(),
        user: std::env::var("PG_USER").unwrap_or("postgres".into()),
        password: std::env::var("PG_PASSWORD").unwrap_or("postgres".into()),
        database: std::env::var("PG_DB").unwrap_or("demo_db".into()),
        sslmode: "prefer".into(),
    }
}

#[tokio::test]
async fn test_connection_ok() {
    let r = db::test_connection(profile()).await;
    assert!(r.ok, "expected ok, got error: {:?}", r.error);
    assert!(r.version.unwrap().contains("PostgreSQL"));
}

#[tokio::test]
async fn test_connection_bad_password_fails() {
    let mut p = profile();
    p.password = "definitely-wrong".into();
    let r = db::test_connection(p).await;
    assert!(!r.ok);
    let e = r.error.unwrap();
    println!("bad-password error: {e}");
    // Must contain actionable server detail, not bare "db error".
    assert!(e.contains("password authentication failed"), "got: {e}");
    assert!(e.contains("28P01"), "got: {e}");
}

#[tokio::test]
async fn connect_without_database_lands_on_postgres() {
    // Empty database = picker flow: connect to maintenance DB, list, switch.
    let mut p = profile();
    p.database = String::new();
    let state = DbState::default();
    let id = db::open_connection(&state, p).await.expect("connect without db");
    let dbs = db::op_list_databases(&state, &id).await.expect("databases");
    assert!(dbs.iter().any(|d| d.name == "demo_db"), "dbs: {dbs:?}");
    db::close_connection(&state, &id);

    // Switch: open a second connection to the picked database.
    let mut p2 = profile();
    p2.database = "demo_db".into();
    let id2 = db::open_connection(&state, p2).await.expect("switch to demo_db");
    let tables = db::op_list_tables(&state, &id2, "public").await.expect("tables");
    assert!(tables.iter().any(|t| t.name == "users"));
    db::close_connection(&state, &id2);
}

#[tokio::test]
async fn test_connection_bad_database_fails() {
    let mut p = profile();
    p.database = "no_such_db_xyz".into();
    let r = db::test_connection(p).await;
    assert!(!r.ok);
    let e = r.error.unwrap();
    println!("bad-database error: {e}");
    assert!(e.contains("no_such_db_xyz"), "got: {e}");
    assert!(e.contains("3D000"), "got: {e}");
}

#[tokio::test]
async fn full_browse_flow() {
    let state = DbState::default();
    let id = db::open_connection(&state, profile()).await.expect("connect");
    let dbs = db::op_list_databases(&state, &id).await.expect("databases");
    assert!(dbs.iter().any(|d| d.name == "demo_db"), "dbs: {dbs:?}");

    let schemas = db::op_list_schemas(&state, &id).await.expect("schemas");
    assert!(schemas.iter().any(|s| s.name == "public"), "schemas: {schemas:?}");

    let tables = db::op_list_tables(&state, &id, "public").await.expect("tables");
    let names: Vec<_> = tables.iter().map(|t| t.name.as_str()).collect();
    assert!(names.contains(&"users"), "tables: {names:?}");
    assert!(names.contains(&"order_summary"));

    let cols = db::op_get_columns(&state, &id, "public", "users").await.expect("columns");
    let id_col = cols.iter().find(|c| c.name == "id").expect("id col");
    assert!(id_col.is_primary);
    assert_eq!(id_col.data_type, "uuid");

    let page = db::op_get_table_data(&state, &id, "public", "users", 2, 0, None, None)
        .await
        .expect("table data");
    assert_eq!(page.total, 3);
    assert_eq!(page.rows.len(), 2);
    assert!(page.columns.contains(&"email".to_string()));

    let sorted = db::op_get_table_data(&state, &id, "public", "users", 10, 0, Some("email".into()), Some("DESC".into()))
        .await
        .expect("sorted");
    assert_eq!(sorted.rows.len(), 3);

    let q = db::op_execute_sql(&state, &id, "SELECT email FROM public.users ORDER BY email").await.expect("select");
    assert_eq!(q.row_count, 3);
    assert_eq!(q.columns, vec!["email"]);

    let info = db::op_server_info(&state, &id).await.expect("server info");
    assert!(info.version.contains("PostgreSQL"));
    assert!(info.table_count >= 5);

    db::close_connection(&state, &id);
}

#[tokio::test]
async fn row_crud_flow() {
    let state = DbState::default();
    let id = db::open_connection(&state, profile()).await.expect("connect");

    // Temp table deliberately has NO primary key: row addressing must work
    // via ctid for any table.
    db::op_execute_sql(&state, &id, "DROP TABLE IF EXISTS public.__px_crud_test")
        .await
        .expect("drop stale");
    db::op_execute_sql(
        &state,
        &id,
        "CREATE TABLE public.__px_crud_test (a TEXT NOT NULL, b INT DEFAULT 7, c JSONB)",
    )
    .await
    .expect("create");

    // Empty tables still report columns (the insert dialog needs them).
    let empty = db::op_get_table_data(&state, &id, "public", "__px_crud_test", 50, 0, None, None)
        .await
        .expect("empty page");
    assert!(empty.editable);
    assert_eq!(empty.columns, vec!["a", "b", "c"]);
    assert!(empty.rows.is_empty());
    assert!(empty.ctids.is_empty());

    // Insert with the DEFAULT column omitted.
    let mut v = HashMap::new();
    v.insert("a".to_string(), serde_json::json!("hello"));
    v.insert("c".to_string(), serde_json::json!({"k": 1}));
    assert_eq!(db::op_insert_row(&state, &id, "public", "__px_crud_test", v).await.expect("insert"), 1);

    // A SQL-injection attempt through values must land as a literal string.
    let evil = "x'); DROP TABLE public.__px_crud_test; --";
    let mut v2 = HashMap::new();
    v2.insert("a".to_string(), serde_json::json!(evil));
    v2.insert("b".to_string(), serde_json::json!(1));
    assert_eq!(db::op_insert_row(&state, &id, "public", "__px_crud_test", v2).await.expect("insert evil"), 1);

    let page = db::op_get_table_data(&state, &id, "public", "__px_crud_test", 50, 0, None, None)
        .await
        .expect("page");
    assert_eq!(page.total, 2);
    assert_eq!(page.ctids.len(), 2);
    assert_ne!(page.ctids[0], page.ctids[1]);
    let ai = page.columns.iter().position(|c| c == "a").unwrap();
    let bi = page.columns.iter().position(|c| c == "b").unwrap();
    assert!(page.rows.iter().any(|r| r[ai] == serde_json::json!(evil)));
    // Omitted DEFAULT was applied by PostgreSQL.
    let hello_row = page.rows.iter().find(|r| r[ai] == serde_json::json!("hello")).expect("hello row");
    assert_eq!(hello_row[bi], serde_json::json!(7));

    // Update by ctid.
    let target = page.ctids[0].clone();
    let mut patch = HashMap::new();
    patch.insert("b".to_string(), serde_json::json!(42));
    assert_eq!(
        db::op_update_row(&state, &id, "public", "__px_crud_test", target.clone(), patch, vec![])
            .await
            .expect("update"),
        1
    );
    // ctid changes on UPDATE, so the stale id must now fail.
    let mut patch2 = HashMap::new();
    patch2.insert("b".to_string(), serde_json::json!(43));
    assert!(db::op_update_row(&state, &id, "public", "__px_crud_test", target, patch2, vec![]).await.is_err());

    let mut page2 = db::op_get_table_data(&state, &id, "public", "__px_crud_test", 50, 0, None, None)
        .await
        .expect("page2");
    let updated: Vec<_> = page2.rows.iter().filter(|r| r[bi] == serde_json::json!(42)).collect();
    assert_eq!(updated.len(), 1);

    // Reset a column to its DEFAULT.
    let fresh_ctid = page2.ctids[0].clone();
    let nopatch: HashMap<String, serde_json::Value> = HashMap::new();
    assert_eq!(
        db::op_update_row(&state, &id, "public", "__px_crud_test", fresh_ctid, nopatch, vec!["b".into()])
            .await
            .expect("reset to default"),
        1
    );
    page2 = db::op_get_table_data(&state, &id, "public", "__px_crud_test", 50, 0, None, None)
        .await
        .expect("page3");
    assert!(page2.rows.iter().any(|r| r[bi] == serde_json::json!(7)));

    // Insert with every column on Default.
    db::op_execute_sql(&state, &id, "DROP TABLE IF EXISTS public.__px_crud_defaults")
        .await
        .expect("drop stale defaults table");
    db::op_execute_sql(&state, &id, "CREATE TABLE public.__px_crud_defaults (b INT DEFAULT 7)")
        .await
        .expect("create defaults table");
    assert_eq!(
        db::op_insert_row(&state, &id, "public", "__px_crud_defaults", HashMap::new())
            .await
            .expect("insert defaults"),
        1
    );
    let def_page = db::op_get_table_data(&state, &id, "public", "__px_crud_defaults", 50, 0, None, None)
        .await
        .expect("defaults page");
    assert_eq!(def_page.total, 1);
    assert_eq!(def_page.rows[0][0], serde_json::json!(7));
    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_crud_defaults").await.expect("cleanup defaults");

    // Bad row ids are rejected before touching SQL.
    let mut bad_patch = HashMap::new();
    bad_patch.insert("b".to_string(), serde_json::json!(1));
    assert!(db::op_update_row(&state, &id, "public", "__px_crud_test", "nonsense".into(), bad_patch, vec![]).await.is_err());
    assert!(db::op_delete_rows(&state, &id, "public", "__px_crud_test", vec!["(0,1'); DROP TABLE x; --".into()]).await.is_err());

    // Bulk delete by ctid.
    let n = db::op_delete_rows(&state, &id, "public", "__px_crud_test", page2.ctids.clone())
        .await
        .expect("delete");
    assert_eq!(n, 2);
    let after = db::op_get_table_data(&state, &id, "public", "__px_crud_test", 50, 0, None, None)
        .await
        .expect("after");
    assert_eq!(after.total, 0);

    // Primary keys are reported for real tables; views are flagged read-only.
    let users = db::op_get_table_data(&state, &id, "public", "users", 10, 0, None, None)
        .await
        .expect("users");
    assert!(users.editable);
    assert_eq!(users.primary_keys, vec!["id"]);
    assert_eq!(users.ctids.len(), users.rows.len());
    let view = db::op_get_table_data(&state, &id, "public", "order_summary", 10, 0, None, None)
        .await
        .expect("view");
    assert!(!view.editable);

    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_crud_test").await.expect("cleanup");
    db::close_connection(&state, &id);
}
