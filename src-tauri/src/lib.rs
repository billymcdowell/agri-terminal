mod commands;
mod core;
mod logging;
mod scheduler;
mod sources;
mod store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            for directory in ["plugins", "cache"] {
                std::fs::create_dir_all(data_directory.join(directory))?;
            }
            let log_guard =
                logging::initialize(&data_directory.join("logs")).map_err(std::io::Error::other)?;
            app.manage(logging::LoggingState(std::sync::Mutex::new(log_guard)));
            let database_path = data_directory.join("agri-terminal.sqlite3");
            let connection = store::open(&database_path).map_err(std::io::Error::other)?;
            app.manage(commands::DbState(std::sync::Mutex::new(connection)));
            scheduler::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_series,
            commands::list_sources,
            commands::refresh_source,
            commands::save_databento_key,
            commands::get_databento_key_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
