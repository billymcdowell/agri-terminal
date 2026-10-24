use std::sync::Mutex;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, State};

use crate::{
    core::{Observation, SourceStatus},
    store,
};

pub struct DbState(pub Mutex<Connection>);

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
    store::query_series(&connection, &series_id, start, end, as_of)
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
pub fn refresh_source(app: AppHandle, source_id: String) -> Result<(), String> {
    if source_id != "fixture-corn" {
        return Err(format!("Unknown source: {source_id}"));
    }
    let state = app.state::<DbState>();
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::refresh_fixture(&connection)?;
    drop(connection);
    app.emit("data-updated", vec!["price.ZC.close"])
        .map_err(|error| format!("Notify price panels: {error}"))
}
