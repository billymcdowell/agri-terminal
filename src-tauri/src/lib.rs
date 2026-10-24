mod analytics;
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
            app.manage(logging::LoggingState {
                _guard: std::sync::Mutex::new(log_guard),
            });
            let database_path = data_directory.join("agri-terminal.sqlite3");
            let connection = store::open(&database_path).map_err(std::io::Error::other)?;
            store::register_sources(&connection).map_err(std::io::Error::other)?;
            // A calendar file in the data directory overrides the bundled schedule, so release
            // dates can be corrected without shipping a new build.
            let calendar = std::fs::read_to_string(data_directory.join("report-calendar.json"))
                .unwrap_or_else(|_| include_str!("../../config/report-calendar.json").to_string());
            store::seed_report_calendar(&connection, &calendar).map_err(std::io::Error::other)?;
            app.manage(commands::DbState(std::sync::Mutex::new(connection)));
            scheduler::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_series,
            commands::list_sources,
            commands::refresh_source,
            commands::save_databento_key,
            commands::get_databento_key_status,
            commands::get_metric_series,
            commands::list_calendar_events,
            commands::get_weather_for_commodity,
            commands::get_news_for_commodity,
            commands::refresh_weather,
            commands::refresh_news,
            commands::save_secret,
            commands::get_secret_status,
            commands::test_connection,
            commands::set_source_enabled,
            commands::list_workspaces,
            commands::save_workspace,
            commands::explain_moves,
            commands::crop_stress_timeline,
            commands::run_backtest,
            commands::get_setting,
            commands::set_setting
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
