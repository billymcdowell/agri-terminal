mod commands;
mod core;
mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("agri-terminal.sqlite3");
            let connection = store::open(&database_path).map_err(std::io::Error::other)?;
            app.manage(commands::DbState(std::sync::Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_series,
            commands::list_sources,
            commands::refresh_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
