//! Live-DB integration tests. Require a local PostgreSQL:
//!   docker run -d --name postiexplorer-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
//!   + seed.sql applied to demo_db.
//! Run: cargo test --test live_db
//! Env overrides: PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DB.

use postiexplorer::{db, models::ConnectionProfile, DbState};

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
