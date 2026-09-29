// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use postiexplorer::{db, models::*, DbState};

// ── Thin Tauri wrappers: all logic lives in db.rs ───────────────

#[tauri::command]
async fn test_connection(profile: ConnectionProfile) -> TestConnectionResult {
    db::test_connection(profile).await
}

#[tauri::command]
async fn connect(state: tauri::State<'_, DbState>, profile: ConnectionProfile) -> Result<String, String> {
    db::open_connection(&state, profile).await
}

#[tauri::command]
async fn disconnect(state: tauri::State<'_, DbState>, connection_id: String) -> Result<(), String> {
    db::close_connection(&state, &connection_id);
    Ok(())
}

#[tauri::command]
async fn list_databases(state: tauri::State<'_, DbState>, connection_id: String) -> Result<Vec<DatabaseEntry>, String> {
    db::op_list_databases(&state, &connection_id).await
}

#[tauri::command]
async fn list_schemas(state: tauri::State<'_, DbState>, connection_id: String) -> Result<Vec<SchemaEntry>, String> {
    db::op_list_schemas(&state, &connection_id).await
}

#[tauri::command]
async fn list_tables(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
) -> Result<Vec<TableEntry>, String> {
    db::op_list_tables(&state, &connection_id, &schema).await
}

#[tauri::command]
async fn get_columns(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnEntry>, String> {
    db::op_get_columns(&state, &connection_id, &schema, &table).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn get_table_data(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    table: String,
    limit: i64,
    offset: i64,
    order_by: Option<String>,
    order_dir: Option<String>,
) -> Result<TableDataResult, String> {
    db::op_get_table_data(&state, &connection_id, &schema, &table, limit, offset, order_by, order_dir).await
}

#[tauri::command]
async fn execute_sql(state: tauri::State<'_, DbState>, connection_id: String, sql: String) -> Result<QueryResult, String> {
    db::op_execute_sql(&state, &connection_id, &sql).await
}

#[tauri::command]
async fn insert_row(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    table: String,
    values: std::collections::HashMap<String, serde_json::Value>,
) -> Result<u64, String> {
    db::op_insert_row(&state, &connection_id, &schema, &table, values).await
}

#[tauri::command]
async fn update_row(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    table: String,
    ctid: String,
    patch: std::collections::HashMap<String, serde_json::Value>,
    defaults: Vec<String>,
) -> Result<u64, String> {
    db::op_update_row(&state, &connection_id, &schema, &table, ctid, patch, defaults).await
}

#[tauri::command]
async fn delete_rows(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    table: String,
    ctids: Vec<String>,
) -> Result<u64, String> {
    db::op_delete_rows(&state, &connection_id, &schema, &table, ctids).await
}

#[tauri::command]
async fn get_server_info(state: tauri::State<'_, DbState>, connection_id: String) -> Result<ServerInfo, String> {
    db::op_server_info(&state, &connection_id).await
}

#[tauri::command]
async fn get_er_model(state: tauri::State<'_, DbState>, connection_id: String) -> Result<ErModel, String> {
    db::op_get_er_model(&state, &connection_id).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DbState::default())
        .invoke_handler(tauri::generate_handler![
            test_connection,
            connect,
            disconnect,
            list_databases,
            list_schemas,
            list_tables,
            get_columns,
            get_table_data,
            execute_sql,
            insert_row,
            update_row,
            delete_rows,
            get_server_info,
            get_er_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
