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
        port: std::env::var("PG_PORT")
            .unwrap_or("5432".into())
            .parse()
            .unwrap(),
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
    let id = db::open_connection(&state, p)
        .await
        .expect("connect without db");
    let dbs = db::op_list_databases(&state, &id).await.expect("databases");
    assert!(dbs.iter().any(|d| d.name == "demo_db"), "dbs: {dbs:?}");
    db::close_connection(&state, &id);

    // Switch: open a second connection to the picked database.
    let mut p2 = profile();
    p2.database = "demo_db".into();
    let id2 = db::open_connection(&state, p2)
        .await
        .expect("switch to demo_db");
    let tables = db::op_list_tables(&state, &id2, "public")
        .await
        .expect("tables");
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
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");
    let dbs = db::op_list_databases(&state, &id).await.expect("databases");
    assert!(dbs.iter().any(|d| d.name == "demo_db"), "dbs: {dbs:?}");

    let schemas = db::op_list_schemas(&state, &id).await.expect("schemas");
    assert!(
        schemas.iter().any(|s| s.name == "public"),
        "schemas: {schemas:?}"
    );

    let tables = db::op_list_tables(&state, &id, "public")
        .await
        .expect("tables");
    let names: Vec<_> = tables.iter().map(|t| t.name.as_str()).collect();
    assert!(names.contains(&"users"), "tables: {names:?}");
    assert!(names.contains(&"order_summary"));

    let cols = db::op_get_columns(&state, &id, "public", "users")
        .await
        .expect("columns");
    let id_col = cols.iter().find(|c| c.name == "id").expect("id col");
    assert!(id_col.is_primary);
    assert_eq!(id_col.data_type, "uuid");

    let page = db::op_get_table_data(&state, &id, "public", "users", 2, 0, None, None)
        .await
        .expect("table data");
    assert_eq!(page.total, 3);
    assert_eq!(page.rows.len(), 2);
    assert!(page.columns.contains(&"email".to_string()));

    let sorted = db::op_get_table_data(
        &state,
        &id,
        "public",
        "users",
        10,
        0,
        Some("email".into()),
        Some("DESC".into()),
    )
    .await
    .expect("sorted");
    assert_eq!(sorted.rows.len(), 3);

    let q = db::op_execute_sql(&state, &id, "SELECT email FROM public.users ORDER BY email")
        .await
        .expect("select");
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
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");

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
    assert_eq!(
        db::op_insert_row(&state, &id, "public", "__px_crud_test", v)
            .await
            .expect("insert"),
        1
    );

    // A SQL-injection attempt through values must land as a literal string.
    let evil = "x'); DROP TABLE public.__px_crud_test; --";
    let mut v2 = HashMap::new();
    v2.insert("a".to_string(), serde_json::json!(evil));
    v2.insert("b".to_string(), serde_json::json!(1));
    assert_eq!(
        db::op_insert_row(&state, &id, "public", "__px_crud_test", v2)
            .await
            .expect("insert evil"),
        1
    );

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
    let hello_row = page
        .rows
        .iter()
        .find(|r| r[ai] == serde_json::json!("hello"))
        .expect("hello row");
    assert_eq!(hello_row[bi], serde_json::json!(7));

    // Update by ctid.
    let target = page.ctids[0].clone();
    let mut patch = HashMap::new();
    patch.insert("b".to_string(), serde_json::json!(42));
    assert_eq!(
        db::op_update_row(
            &state,
            &id,
            "public",
            "__px_crud_test",
            target.clone(),
            patch,
            vec![]
        )
        .await
        .expect("update"),
        1
    );
    // ctid changes on UPDATE, so the stale id must now fail.
    let mut patch2 = HashMap::new();
    patch2.insert("b".to_string(), serde_json::json!(43));
    assert!(db::op_update_row(
        &state,
        &id,
        "public",
        "__px_crud_test",
        target,
        patch2,
        vec![]
    )
    .await
    .is_err());

    let mut page2 =
        db::op_get_table_data(&state, &id, "public", "__px_crud_test", 50, 0, None, None)
            .await
            .expect("page2");
    let updated: Vec<_> = page2
        .rows
        .iter()
        .filter(|r| r[bi] == serde_json::json!(42))
        .collect();
    assert_eq!(updated.len(), 1);

    // Reset a column to its DEFAULT.
    let fresh_ctid = page2.ctids[0].clone();
    let nopatch: HashMap<String, serde_json::Value> = HashMap::new();
    assert_eq!(
        db::op_update_row(
            &state,
            &id,
            "public",
            "__px_crud_test",
            fresh_ctid,
            nopatch,
            vec!["b".into()]
        )
        .await
        .expect("reset to default"),
        1
    );
    page2 = db::op_get_table_data(&state, &id, "public", "__px_crud_test", 50, 0, None, None)
        .await
        .expect("page3");
    assert!(page2.rows.iter().any(|r| r[bi] == serde_json::json!(7)));

    // Insert with every column on Default.
    db::op_execute_sql(
        &state,
        &id,
        "DROP TABLE IF EXISTS public.__px_crud_defaults",
    )
    .await
    .expect("drop stale defaults table");
    db::op_execute_sql(
        &state,
        &id,
        "CREATE TABLE public.__px_crud_defaults (b INT DEFAULT 7)",
    )
    .await
    .expect("create defaults table");
    assert_eq!(
        db::op_insert_row(&state, &id, "public", "__px_crud_defaults", HashMap::new())
            .await
            .expect("insert defaults"),
        1
    );
    let def_page = db::op_get_table_data(
        &state,
        &id,
        "public",
        "__px_crud_defaults",
        50,
        0,
        None,
        None,
    )
    .await
    .expect("defaults page");
    assert_eq!(def_page.total, 1);
    assert_eq!(def_page.rows[0][0], serde_json::json!(7));
    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_crud_defaults")
        .await
        .expect("cleanup defaults");

    // Bad row ids are rejected before touching SQL.
    let mut bad_patch = HashMap::new();
    bad_patch.insert("b".to_string(), serde_json::json!(1));
    assert!(db::op_update_row(
        &state,
        &id,
        "public",
        "__px_crud_test",
        "nonsense".into(),
        bad_patch,
        vec![]
    )
    .await
    .is_err());
    assert!(db::op_delete_rows(
        &state,
        &id,
        "public",
        "__px_crud_test",
        vec!["(0,1'); DROP TABLE x; --".into()]
    )
    .await
    .is_err());

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

    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_crud_test")
        .await
        .expect("cleanup");
    db::close_connection(&state, &id);
}

#[tokio::test]
async fn privileges_owner_has_full_access() {
    let state = DbState::default();
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");

    // Lists now carry privilege flags for up-front gating.
    let dbs = db::op_list_databases(&state, &id).await.expect("databases");
    let demo = dbs.iter().find(|d| d.name == "demo_db").expect("demo_db");
    assert!(
        demo.can_connect,
        "owner should CONNECT to demo_db: {demo:?}"
    );

    let schemas = db::op_list_schemas(&state, &id).await.expect("schemas");
    let public = schemas
        .iter()
        .find(|s| s.name == "public")
        .expect("public schema");
    assert!(public.can_usage, "owner should have USAGE: {public:?}");
    assert!(public.can_create, "owner should have CREATE: {public:?}");

    let tables = db::op_list_tables(&state, &id, "public")
        .await
        .expect("tables");
    let users_entry = tables
        .iter()
        .find(|t| t.name == "users")
        .expect("users entry");
    assert!(
        users_entry.can_select,
        "owner should SELECT: {users_entry:?}"
    );

    // Detailed table privileges.
    let privs = db::op_get_table_privileges(&state, &id, "public", "users")
        .await
        .expect("table privs");
    assert_eq!(privs.current_user, "postgres");
    assert!(privs.is_superuser);
    assert!(
        privs.select && privs.insert && privs.update && privs.delete,
        "privs: {privs:?}"
    );
    assert!(
        privs.can_alter && privs.can_drop,
        "owner/superuser can ALTER/DROP: {privs:?}"
    );

    let sprivs = db::op_get_schema_privileges(&state, &id, "public")
        .await
        .expect("schema privs");
    assert!(sprivs.usage && sprivs.create, "sprivs: {sprivs:?}");

    // TableDataResult carries the same flags so the Data tab can disable
    // Add/Edit/Delete without waiting for a permission-denied error.
    let page = db::op_get_table_data(&state, &id, "public", "users", 5, 0, None, None)
        .await
        .expect("page");
    assert!(
        page.can_select && page.can_insert && page.can_update && page.can_delete,
        "page privs: {:?}",
        (
            &page.can_select,
            &page.can_insert,
            &page.can_update,
            &page.can_delete
        )
    );

    // Views are readable but never row-editable.
    let view_privs = db::op_get_table_privileges(&state, &id, "public", "order_summary")
        .await
        .expect("view privs");
    assert!(view_privs.select, "view privs: {view_privs:?}");
    let view_page = db::op_get_table_data(&state, &id, "public", "order_summary", 5, 0, None, None)
        .await
        .expect("view page");
    assert!(!view_page.editable);

    db::close_connection(&state, &id);
}

#[tokio::test]
async fn ddl_structure_flow() {
    use postiexplorer::models::NewColumnDef;
    let state = DbState::default();
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");
    let tbl = "public.__px_ddl_test";

    db::op_execute_sql(&state, &id, &format!("DROP TABLE IF EXISTS {tbl}"))
        .await
        .expect("drop stale");

    // CREATE TABLE via the structured API (identifiers quoted, types validated).
    let cols = vec![
        NewColumnDef {
            name: "id".into(),
            data_type: "UUID".into(),
            is_nullable: false,
            default_value: Some("gen_random_uuid()".into()),
            is_primary: true,
        },
        NewColumnDef {
            name: "nick".into(),
            data_type: "TEXT".into(),
            is_nullable: true,
            default_value: None,
            is_primary: false,
        },
        NewColumnDef {
            name: "score".into(),
            data_type: "INTEGER".into(),
            is_nullable: false,
            default_value: Some("0".into()),
            is_primary: false,
        },
    ];
    db::op_create_table(&state, &id, "public", "__px_ddl_test", cols)
        .await
        .expect("create table");

    let got = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("columns");
    assert_eq!(got.len(), 3);
    assert!(got.iter().find(|c| c.name == "id").unwrap().is_primary);

    // Validation: duplicate names, unsafe types/defaults rejected before SQL.
    let dup = vec![
        NewColumnDef {
            name: "a".into(),
            data_type: "TEXT".into(),
            is_nullable: true,
            default_value: None,
            is_primary: false,
        },
        NewColumnDef {
            name: "A".into(),
            data_type: "TEXT".into(),
            is_nullable: true,
            default_value: None,
            is_primary: false,
        },
    ];
    assert!(
        db::op_create_table(&state, &id, "public", "__px_ddl_dup", dup)
            .await
            .is_err()
    );
    let evil_type = NewColumnDef {
        name: "x".into(),
        data_type: "TEXT; DROP TABLE public.users; --".into(),
        is_nullable: true,
        default_value: None,
        is_primary: false,
    };
    assert!(
        db::op_add_column(&state, &id, "public", "__px_ddl_test", evil_type)
            .await
            .is_err()
    );

    // ADD COLUMN.
    db::op_add_column(
        &state,
        &id,
        "public",
        "__px_ddl_test",
        NewColumnDef {
            name: "extra".into(),
            data_type: "VARCHAR(50)".into(),
            is_nullable: true,
            default_value: Some("'hi'".into()),
            is_primary: false,
        },
    )
    .await
    .expect("add column");
    let after_add = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("after add");
    assert_eq!(after_add.len(), 4);
    let extra_def = after_add
        .iter()
        .find(|c| c.name == "extra")
        .unwrap()
        .default_value
        .clone()
        .unwrap_or_default();
    assert!(extra_def.contains("'hi'"), "extra default: {extra_def}");

    // RENAME COLUMN.
    db::op_rename_column(&state, &id, "public", "__px_ddl_test", "nick", "nickname")
        .await
        .expect("rename");
    let after_rename = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("after rename");
    assert!(after_rename.iter().any(|c| c.name == "nickname"));
    assert!(!after_rename.iter().any(|c| c.name == "nick"));

    // ALTER TYPE + NULLABLE + DEFAULT.
    db::op_alter_column_type(&state, &id, "public", "__px_ddl_test", "score", "BIGINT")
        .await
        .expect("alter type");
    let after_type = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("after type");
    assert!(after_type
        .iter()
        .find(|c| c.name == "score")
        .unwrap()
        .data_type
        .contains("bigint"));

    db::op_set_column_nullable(&state, &id, "public", "__px_ddl_test", "nickname", false)
        .await
        .expect("set not null");
    let after_nn = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("after nn");
    assert!(
        !after_nn
            .iter()
            .find(|c| c.name == "nickname")
            .unwrap()
            .is_nullable
    );

    db::op_set_column_default(
        &state,
        &id,
        "public",
        "__px_ddl_test",
        "nickname",
        Some("'anon'".into()),
    )
    .await
    .expect("set default");
    let after_def = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("after def");
    let nick_def = after_def
        .iter()
        .find(|c| c.name == "nickname")
        .unwrap()
        .default_value
        .clone()
        .unwrap_or_default();
    assert!(nick_def.contains("'anon'"), "nickname default: {nick_def}");
    db::op_set_column_default(&state, &id, "public", "__px_ddl_test", "nickname", None)
        .await
        .expect("drop default");
    let after_drop_def = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("after drop def");
    assert!(after_drop_def
        .iter()
        .find(|c| c.name == "nickname")
        .unwrap()
        .default_value
        .is_none());

    // Unsafe default chained statements rejected.
    assert!(db::op_set_column_default(
        &state,
        &id,
        "public",
        "__px_ddl_test",
        "nickname",
        Some("1; DROP TABLE x".into())
    )
    .await
    .is_err());

    // DROP COLUMN + DROP TABLE.
    db::op_drop_column(&state, &id, "public", "__px_ddl_test", "extra")
        .await
        .expect("drop column");
    let after_drop = db::op_get_columns(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("after drop col");
    assert!(!after_drop.iter().any(|c| c.name == "extra"));

    db::op_drop_table(&state, &id, "public", "__px_ddl_test")
        .await
        .expect("drop table");
    assert!(
        db::op_get_columns(&state, &id, "public", "__px_ddl_test")
            .await
            .unwrap()
            .is_empty()
            || db::op_get_table_data(&state, &id, "public", "__px_ddl_test", 1, 0, None, None)
                .await
                .is_err()
    );

    db::close_connection(&state, &id);
}

#[tokio::test]
async fn permissions_gating_readonly_user() {
    use postiexplorer::models::NewColumnDef;
    let admin_state = DbState::default();
    let admin_id = db::open_connection(&admin_state, profile())
        .await
        .expect("admin connect");

    // Fresh readonly role with only SELECT (no CREATE/INSERT/UPDATE/DELETE/ALTER).
    // Scope GRANTs to the single test table so parallel tests sharing `public`
    // are unaffected (no blanket ON ALL TABLES / DEFAULT PRIVILEGES).
    db::op_execute_sql(
        &admin_state,
        &admin_id,
        "DROP TABLE IF EXISTS public.__px_priv_test",
    )
    .await
    .expect("drop stale priv table");
    db::op_execute_sql(
        &admin_state,
        &admin_id,
        "CREATE TABLE public.__px_priv_test (a TEXT NOT NULL, b INT DEFAULT 1)",
    )
    .await
    .expect("create priv table");
    db::op_execute_sql(&admin_state, &admin_id, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='px_readonly') THEN CREATE ROLE px_readonly LOGIN PASSWORD 'readonly123'; END IF; END $$").await.expect("create role");
    db::op_execute_sql(
        &admin_state,
        &admin_id,
        "GRANT CONNECT ON DATABASE demo_db TO px_readonly",
    )
    .await
    .expect("grant connect");
    db::op_execute_sql(
        &admin_state,
        &admin_id,
        "GRANT USAGE ON SCHEMA public TO px_readonly",
    )
    .await
    .expect("grant usage");
    db::op_execute_sql(
        &admin_state,
        &admin_id,
        "GRANT SELECT ON public.__px_priv_test TO px_readonly",
    )
    .await
    .expect("grant select");
    // Make sure no write privileges linger from previous runs (scoped to this table only).
    db::op_execute_sql(
        &admin_state,
        &admin_id,
        "REVOKE CREATE ON SCHEMA public FROM px_readonly",
    )
    .await
    .ok();
    db::op_execute_sql(&admin_state, &admin_id, "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.__px_priv_test FROM px_readonly").await.ok();

    let mut ro = profile();
    ro.user = "px_readonly".into();
    ro.password = "readonly123".into();
    let ro_state = DbState::default();
    let ro_id = db::open_connection(&ro_state, ro)
        .await
        .expect("readonly connect");

    // Read allowed, writes gated.
    let privs = db::op_get_table_privileges(&ro_state, &ro_id, "public", "__px_priv_test")
        .await
        .expect("ro privs");
    assert_eq!(privs.current_user, "px_readonly");
    assert!(!privs.is_superuser);
    assert!(!privs.is_owner);
    assert!(privs.select, "readonly should SELECT: {privs:?}");
    assert!(
        !privs.insert && !privs.update && !privs.delete,
        "readonly must not write: {privs:?}"
    );
    assert!(
        !privs.can_alter && !privs.can_drop,
        "readonly must not ALTER/DROP: {privs:?}"
    );

    let sprivs = db::op_get_schema_privileges(&ro_state, &ro_id, "public")
        .await
        .expect("ro schema privs");
    assert!(sprivs.usage, "readonly should have USAGE: {sprivs:?}");
    assert!(!sprivs.create, "readonly must not CREATE: {sprivs:?}");

    let page = db::op_get_table_data(
        &ro_state,
        &ro_id,
        "public",
        "__px_priv_test",
        10,
        0,
        None,
        None,
    )
    .await
    .expect("ro page");
    assert!(page.can_select);
    assert!(
        !page.can_insert && !page.can_update && !page.can_delete,
        "page flags must gate buttons: {:?}",
        (&page.can_insert, &page.can_update, &page.can_delete)
    );

    let tables = db::op_list_tables(&ro_state, &ro_id, "public")
        .await
        .expect("ro tables");
    let entry = tables
        .iter()
        .find(|t| t.name == "__px_priv_test")
        .expect("priv test entry");
    assert!(entry.can_select);

    // DDL as readonly must fail with a permission error (frontend disables these up-front).
    let new_cols = vec![NewColumnDef {
        name: "x".into(),
        data_type: "TEXT".into(),
        is_nullable: true,
        default_value: None,
        is_primary: false,
    }];
    let create_err = db::op_create_table(&ro_state, &ro_id, "public", "__px_priv_nope", new_cols)
        .await
        .expect_err("readonly create must fail");
    assert!(
        create_err.to_lowercase().contains("permission")
            || create_err.to_lowercase().contains("denied"),
        "got: {create_err}"
    );
    let add_err = db::op_add_column(
        &ro_state,
        &ro_id,
        "public",
        "__px_priv_test",
        NewColumnDef {
            name: "nope".into(),
            data_type: "TEXT".into(),
            is_nullable: true,
            default_value: None,
            is_primary: false,
        },
    )
    .await
    .expect_err("readonly add must fail");
    assert!(
        add_err.to_lowercase().contains("permission")
            || add_err.to_lowercase().contains("denied")
            || add_err.contains("must be owner"),
        "got: {add_err}"
    );

    // DML as readonly must also fail server-side (belt and braces behind disabled buttons).
    let mut v = HashMap::new();
    v.insert("a".to_string(), serde_json::json!("hi"));
    assert!(
        db::op_insert_row(&ro_state, &ro_id, "public", "__px_priv_test", v)
            .await
            .is_err()
    );

    db::close_connection(&ro_state, &ro_id);
    db::op_execute_sql(
        &admin_state,
        &admin_id,
        "DROP TABLE IF EXISTS public.__px_priv_test",
    )
    .await
    .expect("cleanup priv table");
    db::op_execute_sql(&admin_state, &admin_id, "DROP OWNED BY px_readonly")
        .await
        .ok();
    db::op_execute_sql(&admin_state, &admin_id, "DROP ROLE IF EXISTS px_readonly")
        .await
        .expect("drop role");
    db::close_connection(&admin_state, &admin_id);
}

#[tokio::test]
async fn sql_batch_flow() {
    let state = DbState::default();
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");

    // Single statement still works through the batch API.
    let one = db::op_execute_sql_batch(&state, &id, "SELECT 1 AS one")
        .await
        .expect("single");
    assert_eq!(one.results.len(), 1);
    assert_eq!(one.results[0].columns, vec!["one"]);
    assert_eq!(one.results[0].row_count, 1);

    // Multi-statement: two SELECTs plus a write in the middle.
    let multi = db::op_execute_sql_batch(
        &state,
        &id,
        "SELECT 1 AS a; SELECT 2 AS b, 3 AS c; SELECT email FROM public.users ORDER BY email LIMIT 1",
    )
    .await
    .expect("multi");
    assert_eq!(multi.results.len(), 3, "results: {:?}", multi.results);
    assert_eq!(multi.results[0].columns, vec!["a"]);
    assert_eq!(multi.results[1].columns, vec!["b", "c"]);
    assert_eq!(multi.results[2].columns, vec!["email"]);

    // Semicolons inside literals/comments must not split. The second
    // statement creates a temp table via a dollar-quoted function body
    // containing `;`, proving the splitter is quote-aware.
    let tricky = db::op_execute_sql_batch(
        &state,
        &id,
        "SELECT 'a;b' AS lit, 'it''s; fine' AS esc; \
         CREATE OR REPLACE FUNCTION public.__px_batch_fn() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; \
         SELECT public.__px_batch_fn() AS fn_val; \
         DROP FUNCTION public.__px_batch_fn()",
    )
    .await
    .expect("tricky batch");
    assert_eq!(tricky.results.len(), 4, "results: {:?}", tricky.results);
    assert_eq!(tricky.results[0].rows[0][0], serde_json::json!("a;b"));

    // Comments with semicolons are ignored for splitting but preserved.
    let comments = db::op_execute_sql_batch(
        &state,
        &id,
        "-- leading comment; with semicolon\nSELECT 1 AS x /* block; comment */",
    )
    .await
    .expect("comments");
    assert_eq!(comments.results.len(), 1);

    // Empty / comment-only input is rejected like the single path.
    assert!(db::op_execute_sql_batch(&state, &id, "   ").await.is_err());
    assert!(db::op_execute_sql_batch(&state, &id, " -- only a comment ")
        .await
        .is_err());

    // Failures report the 1-based statement index with server detail.
    let err = db::op_execute_sql_batch(
        &state,
        &id,
        "SELECT 1 AS ok; SELECT * FROM no_such_table_xyz",
    )
    .await
    .expect_err("second statement must fail");
    assert!(err.contains("statement 2 failed"), "got: {err}");
    assert!(err.contains("42P01"), "got: {err}");

    db::close_connection(&state, &id);
}

#[tokio::test]
async fn import_rows_flow() {
    let state = DbState::default();
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");

    db::op_execute_sql(&state, &id, "DROP TABLE IF EXISTS public.__px_import_test")
        .await
        .expect("drop stale");
    db::op_execute_sql(
        &state,
        &id,
        "CREATE TABLE public.__px_import_test (a TEXT NOT NULL, b INT DEFAULT 7)",
    )
    .await
    .expect("create");

    // Multi-row insert through the CSV import path.
    let n = db::op_import_rows(
        &state,
        &id,
        "public",
        "__px_import_test",
        vec!["a".into(), "b".into()],
        vec![
            vec![serde_json::json!("hello"), serde_json::json!("1")],
            vec![serde_json::json!("world"), serde_json::Value::Null],
        ],
    )
    .await
    .expect("import");
    assert_eq!(n, 2);
    let page = db::op_get_table_data(&state, &id, "public", "__px_import_test", 50, 0, None, None)
        .await
        .expect("page");
    assert_eq!(page.total, 2);

    // Injection payloads land as literals, never as SQL.
    let evil = "x'); DROP TABLE public.__px_import_test; --";
    let n2 = db::op_import_rows(
        &state,
        &id,
        "public",
        "__px_import_test",
        vec!["a".into()],
        vec![vec![serde_json::json!(evil)]],
    )
    .await
    .expect("import evil");
    assert_eq!(n2, 1);
    let page2 = db::op_get_table_data(&state, &id, "public", "__px_import_test", 50, 0, None, None)
        .await
        .expect("page2");
    assert_eq!(page2.total, 3);

    // Validation: empty columns/rows, ragged rows, bad identifiers rejected.
    assert!(
        db::op_import_rows(&state, &id, "public", "__px_import_test", vec![], vec![])
            .await
            .is_err()
    );
    assert!(db::op_import_rows(
        &state,
        &id,
        "public",
        "__px_import_test",
        vec!["a".into()],
        vec![vec![serde_json::json!("x"), serde_json::json!("extra")]],
    )
    .await
    .is_err());
    assert!(db::op_import_rows(
        &state,
        &id,
        "public",
        "__px_import_test",
        vec!["a; DROP TABLE x".into()],
        vec![vec![serde_json::json!("x")]],
    )
    .await
    .is_err());

    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_import_test")
        .await
        .expect("cleanup");
    db::close_connection(&state, &id);
}

#[tokio::test]
async fn dump_ddl_flow() {
    let state = DbState::default();
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");

    // Parent + child with PK / FK / UNIQUE / CHECK / DEFAULT / NOT NULL.
    db::op_execute_sql(&state, &id, "DROP TABLE IF EXISTS public.__px_dump_child")
        .await
        .expect("drop stale child");
    db::op_execute_sql(&state, &id, "DROP TABLE IF EXISTS public.__px_dump_parent")
        .await
        .expect("drop stale parent");
    db::op_execute_sql(
        &state,
        &id,
        "CREATE TABLE public.__px_dump_parent (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')))",
    )
    .await
    .expect("create parent");
    db::op_execute_sql(
        &state,
        &id,
        "CREATE TABLE public.__px_dump_child (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, parent_id UUID NOT NULL REFERENCES public.__px_dump_parent(id) ON DELETE CASCADE, note TEXT DEFAULT 'hi')",
    )
    .await
    .expect("create child");
    db::op_execute_sql(
        &state,
        &id,
        "CREATE INDEX __px_dump_child_note_idx ON public.__px_dump_child (note)",
    )
    .await
    .expect("create index");

    let parent = db::op_get_table_ddl(&state, &id, "public", "__px_dump_parent")
        .await
        .expect("parent ddl");
    assert_eq!(parent.kind, "table");
    assert!(parent.ddl.contains("CREATE TABLE"), "ddl: {}", parent.ddl);
    assert!(parent.ddl.contains("\"email\""), "ddl: {}", parent.ddl);
    assert!(parent.ddl.contains("NOT NULL"), "ddl: {}", parent.ddl);
    assert!(parent.ddl.contains("DEFAULT"), "ddl: {}", parent.ddl);
    assert!(parent.ddl.contains("PRIMARY KEY"), "ddl: {}", parent.ddl);
    assert!(parent.ddl.contains("UNIQUE"), "ddl: {}", parent.ddl);
    assert!(parent.ddl.contains("CHECK"), "ddl: {}", parent.ddl);

    let child = db::op_get_table_ddl(&state, &id, "public", "__px_dump_child")
        .await
        .expect("child ddl");
    assert!(child.ddl.contains("REFERENCES"), "ddl: {}", child.ddl);
    assert!(child.ddl.contains("__px_dump_parent"), "ddl: {}", child.ddl);
    assert!(
        child.ddl.contains("__px_dump_child_note_idx"),
        "ddl: {}",
        child.ddl
    );

    // Views dump as CREATE OR REPLACE VIEW.
    let view = db::op_get_table_ddl(&state, &id, "public", "order_summary")
        .await
        .expect("view ddl");
    assert_eq!(view.kind, "view");
    assert!(
        view.ddl.to_uppercase().contains("CREATE"),
        "ddl: {}",
        view.ddl
    );
    assert!(
        view.ddl.to_uppercase().contains("VIEW"),
        "ddl: {}",
        view.ddl
    );

    // Missing relations error with an actionable message.
    assert!(
        db::op_get_table_ddl(&state, &id, "public", "no_such_table_xyz")
            .await
            .is_err()
    );

    // Round-trip: the dumped DDL recreates an identical shape.
    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_dump_child")
        .await
        .expect("drop child");
    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_dump_parent")
        .await
        .expect("drop parent");
    db::op_execute_sql_batch(&state, &id, &parent.ddl)
        .await
        .expect("recreate parent");
    db::op_execute_sql_batch(&state, &id, &child.ddl)
        .await
        .expect("recreate child");
    let cols = db::op_get_columns(&state, &id, "public", "__px_dump_parent")
        .await
        .expect("cols");
    assert!(cols.iter().any(|c| c.name == "email" && !c.is_nullable));
    let privs = db::op_get_table_privileges(&state, &id, "public", "__px_dump_child")
        .await
        .expect("privs");
    assert!(privs.select, "privs: {privs:?}");

    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_dump_child")
        .await
        .expect("cleanup child");
    db::op_execute_sql(&state, &id, "DROP TABLE public.__px_dump_parent")
        .await
        .expect("cleanup parent");
    db::close_connection(&state, &id);
}

#[tokio::test]
async fn roles_manager_flow() {
    use postiexplorer::models::RoleOptions;
    fn opts() -> RoleOptions {
        RoleOptions {
            password: None,
            can_login: true,
            superuser: false,
            create_db: false,
            create_role: false,
            inherit: true,
            replication: false,
            conn_limit: -1,
            valid_until: None,
        }
    }
    let state = DbState::default();
    let id = db::open_connection(&state, profile())
        .await
        .expect("connect");

    // Cleanup from previous runs (scoped to our test roles only).
    for r in [
        "__px_role_a",
        "__px_role_b",
        "__px_role_evil'] ; DROP TABLE public.users; --",
    ] {
        let _ = db::op_drop_role(&state, &id, r).await;
    }

    // Lists carry the current user + superuser flag for up-front gating.
    let list = db::op_list_roles(&state, &id).await.expect("list roles");
    assert_eq!(list.current_user, "postgres");
    assert!(list.is_superuser);
    assert!(list
        .roles
        .iter()
        .any(|r| r.name == "postgres" && r.can_login));

    // Create with password + connection limit.
    let mut create = opts();
    create.password = Some("s3cret!; DROP TABLE x; --".into());
    create.conn_limit = 5;
    db::op_create_role(&state, &id, "__px_role_a", create)
        .await
        .expect("create role");
    let after = db::op_list_roles(&state, &id).await.expect("relist");
    let a = after
        .roles
        .iter()
        .find(|r| r.name == "__px_role_a")
        .expect("role a");
    assert!(a.can_login && !a.superuser);
    assert_eq!(a.conn_limit, 5);

    // Duplicate creation fails with server detail.
    assert!(db::op_create_role(&state, &id, "__px_role_a", opts())
        .await
        .is_err());

    // An injection attempt in the name lands as a quoted identifier:
    // the role is created, `public.users` still exists.
    let evil = "__px_role_evil'] ; DROP TABLE public.users; --";
    db::op_create_role(&state, &id, evil, opts())
        .await
        .expect("create evil-named role");
    let tables = db::op_list_tables(&state, &id, "public")
        .await
        .expect("tables intact");
    assert!(tables.iter().any(|t| t.name == "users"));
    db::op_drop_role(&state, &id, evil)
        .await
        .expect("drop evil-named role");

    // Alter: flip attributes, set + clear expiry.
    let mut alt = opts();
    alt.create_db = true;
    alt.valid_until = Some("2030-01-01 00:00:00+00".into());
    db::op_alter_role(&state, &id, "__px_role_a", alt)
        .await
        .expect("alter role");
    let altered = db::op_list_roles(&state, &id).await.expect("relist2");
    let a2 = altered
        .roles
        .iter()
        .find(|r| r.name == "__px_role_a")
        .expect("role a2");
    assert!(a2.create_db);
    assert!(a2.valid_until.as_deref().unwrap_or("").contains("2030"));
    let mut clear = opts();
    clear.valid_until = Some(String::new());
    db::op_alter_role(&state, &id, "__px_role_a", clear)
        .await
        .expect("clear expiry");
    let cleared = db::op_list_roles(&state, &id).await.expect("relist3");
    assert!(cleared
        .roles
        .iter()
        .find(|r| r.name == "__px_role_a")
        .expect("role a3")
        .valid_until
        .is_none());

    // Validation: empty name, bad limit rejected before SQL.
    assert!(db::op_create_role(&state, &id, "  ", opts()).await.is_err());
    let mut bad = opts();
    bad.conn_limit = -5;
    assert!(db::op_create_role(&state, &id, "__px_role_b", bad)
        .await
        .is_err());

    // Memberships: grant / list both directions / revoke.
    db::op_create_role(&state, &id, "__px_role_b", opts())
        .await
        .expect("create b");
    db::op_grant_role(&state, &id, "__px_role_a", "__px_role_b")
        .await
        .expect("grant");
    let mem = db::op_get_role_memberships(&state, &id, "__px_role_a")
        .await
        .expect("memberships");
    assert!(
        mem.members.contains(&"__px_role_b".to_string()),
        "mem: {mem:?}"
    );
    let mem_b = db::op_get_role_memberships(&state, &id, "__px_role_b")
        .await
        .expect("memberships b");
    assert!(
        mem_b.member_of.contains(&"__px_role_a".to_string()),
        "mem_b: {mem_b:?}"
    );
    db::op_revoke_role(&state, &id, "__px_role_a", "__px_role_b")
        .await
        .expect("revoke");
    let mem2 = db::op_get_role_memberships(&state, &id, "__px_role_a")
        .await
        .expect("memberships2");
    assert!(
        !mem2.members.contains(&"__px_role_b".to_string()),
        "mem2: {mem2:?}"
    );
    assert!(db::op_get_role_memberships(&state, &id, "no_such_role_xyz")
        .await
        .is_err());

    // Guardrail: cannot drop the role we are connected as.
    let own_err = db::op_drop_role(&state, &id, "postgres")
        .await
        .expect_err("drop self must fail");
    assert!(own_err.contains("postgres"), "got: {own_err}");

    db::op_drop_role(&state, &id, "__px_role_a")
        .await
        .expect("drop a");
    db::op_drop_role(&state, &id, "__px_role_b")
        .await
        .expect("drop b");
    db::close_connection(&state, &id);
}
