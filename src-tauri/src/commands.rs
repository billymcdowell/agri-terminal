use std::sync::Mutex;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    core::{DataSource, Observation, SourceStatus},
    sources::databento,
    store,
};

pub struct DbState(pub Mutex<Connection>);

fn with_connection<T>(
    app: &AppHandle,
    operation: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<DbState>();
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    operation(&connection)
}

#[tauri::command]
pub fn get_series(
    state: State<'_, DbState>,
    series_id: String,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
    as_of: Option<DateTime<Utc>>,
) -> Result<Vec<Observation>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    let observations = store::query_series(&connection, &series_id, start, end, as_of)?;
    if observations.is_empty() && series_id == "price.ZC.close" {
        return store::query_series(&connection, "demo.price.ZC.close", start, end, as_of);
    }
    Ok(observations)
}

#[tauri::command]
pub fn list_sources(state: State<'_, DbState>) -> Result<Vec<SourceStatus>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_sources(&connection)
}

#[tauri::command]
pub fn save_databento_key(key: String) -> Result<(), String> {
    databento::save_api_key(&key).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_databento_key_status() -> bool {
    databento::has_api_key()
}

#[tauri::command]
pub async fn refresh_source(app: AppHandle, source_id: String) -> Result<(), String> {
    match source_id.as_str() {
        "fixture-corn" => {
            with_connection(&app, store::refresh_fixture)?;
        }
        "databento" => {
            let observations = match databento::DatabentoSource.fetch().await {
                Ok(observations) => observations,
                Err(error) => {
                    let message = error.to_string();
                    with_connection(&app, |connection| {
                        store::mark_source_error(connection, "databento", &message)
                    })?;
                    let _ = app.emit("source-status", "databento:error");
                    return Err(message);
                }
            };
            with_connection(&app, |connection| {
                store::append_observations_as_revisions(connection, &observations)?;
                store::mark_source_success(
                    connection,
                    "databento",
                    "Databento · GLBX.MDP3",
                    Utc::now(),
                    false,
                )
            })?;
        }
        _ => return Err(format!("Unknown source: {source_id}")),
    }
    app.emit("data-updated", vec!["price.ZC.close"])
        .map_err(|error| format!("Notify price panels: {error}"))?;
    app.emit("source-status", format!("{source_id}:ok"))
        .map_err(|error| format!("Notify source status: {error}"))
}
