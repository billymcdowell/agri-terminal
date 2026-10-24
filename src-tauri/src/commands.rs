use std::sync::Mutex;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    analytics::{
        attribution::{self, MoveExplanation},
        backtest::{self, BacktestReport, LabelFile},
        combined::{self, StressPoint},
        moves::{self, PricePoint},
    },
    core::{DataSource, MetricObservation, Observation, SourceStatus},
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
pub fn get_metric_series(
    state: State<'_, DbState>,
    series_id: String,
) -> Result<Vec<MetricObservation>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::query_metric_series(&connection, &series_id)
}

#[tauri::command]
pub fn list_calendar_events(
    state: State<'_, DbState>,
) -> Result<Vec<crate::core::CalendarEvent>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_calendar_events(&connection, Utc::now())
}

fn crop_region_config() -> Result<crate::sources::phase4::CropRegionConfig, String> {
    serde_json::from_str(include_str!("../../config/crop-regions.json"))
        .map_err(|error| format!("Parse crop-region configuration: {error}"))
}

/// Cached forecasts only; `refresh_weather` fills the cache in the background.
#[tauri::command]
pub fn get_weather_for_commodity(
    state: State<'_, DbState>,
    commodity: String,
) -> Result<crate::core::WeatherSnapshot, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::load_weather_snapshot(&connection, &commodity.to_ascii_uppercase())
}

#[tauri::command]
pub async fn refresh_weather(app: AppHandle, commodity: String) -> Result<(), String> {
    let commodity = commodity.to_ascii_uppercase();
    let forecasts =
        crate::sources::phase4::weather_for_commodity(&commodity, &crop_region_config()?).await?;
    with_connection(&app, |connection| {
        store::save_weather_snapshot(connection, &commodity, &forecasts, Utc::now())
    })?;
    app.emit("data-updated", vec![format!("weather.{commodity}")])
        .map_err(|error| format!("Notify weather panels: {error}"))
}

/// Cached headlines only; `refresh_news` fetches new ones.
#[tauri::command]
pub fn get_news_for_commodity(
    state: State<'_, DbState>,
    commodity: String,
) -> Result<Vec<crate::core::NewsItem>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_news_items(&connection, &commodity.to_ascii_uppercase())
}

#[tauri::command]
pub async fn refresh_news(app: AppHandle, commodity: String) -> Result<(), String> {
    let commodity = commodity.to_ascii_uppercase();
    let config = crop_region_config()?;
    let items = crate::sources::phase4::news_for_commodity(&commodity, &config.rss_feeds).await?;
    with_connection(&app, |connection| {
        store::save_news_items(connection, &items)
    })?;
    app.emit("data-updated", vec![format!("news.{commodity}")])
        .map_err(|error| format!("Notify news panels: {error}"))
}

#[tauri::command]
pub fn save_secret(id: String, value: String) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Secret cannot be empty".into());
    }
    keyring::Entry::new("com.williammcdowell.agri-terminal", &id)
        .map_err(|error| error.to_string())?
        .set_password(value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_secret_status(id: String) -> bool {
    keyring::Entry::new("com.williammcdowell.agri-terminal", &id)
        .and_then(|entry| entry.get_password())
        .is_ok()
}

#[tauri::command]
pub fn set_source_enabled(
    state: State<'_, DbState>,
    source_id: String,
    enabled: bool,
) -> Result<(), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::set_source_enabled(&connection, &source_id, enabled)
}

#[tauri::command]
pub async fn test_connection(source_id: String) -> Result<(), String> {
    let source: Box<dyn DataSource> = match source_id.as_str() {
        "databento" => Box::new(databento::DatabentoSource),
        "cftc-cot" => Box::new(crate::sources::fundamentals::CftcSource),
        "usda-nass" => Box::new(crate::sources::fundamentals::NassSource),
        "usda-fas" => Box::new(crate::sources::fundamentals::FasSource),
        "us-drought-monitor" => Box::new(crate::sources::fundamentals::DroughtSource),
        _ => return Err(format!("Source {source_id} has no connection test")),
    };
    source
        .fetch()
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
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
pub fn list_workspaces(state: State<'_, DbState>) -> Result<Vec<(String, String, String)>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_workspaces(&connection)
}

#[tauri::command]
pub fn save_workspace(
    state: State<'_, DbState>,
    id: String,
    name: String,
    json: String,
) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|error| format!("Invalid workspace JSON: {error}"))?;
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::save_workspace(&connection, &id, &name, &json)
}

#[tauri::command]
pub async fn refresh_source(app: AppHandle, source_id: String) -> Result<(), String> {
    let source: Box<dyn DataSource> = match source_id.as_str() {
        "fixture-corn" => Box::new(crate::sources::fixture::CornFixtureSource),
        "databento" => Box::new(databento::DatabentoSource),
        "cftc-cot" => Box::new(crate::sources::fundamentals::CftcSource),
        "usda-nass" => Box::new(crate::sources::fundamentals::NassSource),
        "usda-fas" => Box::new(crate::sources::fundamentals::FasSource),
        "us-drought-monitor" => Box::new(crate::sources::fundamentals::DroughtSource),
        _ => return Err(format!("Unknown source: {source_id}")),
    };
    let records = match source.fetch().await {
        Ok(records) => records,
        Err(error) => {
            let message = error.to_string();
            let retry_after = match error {
                crate::core::SourceError::RateLimited { retry_after } => retry_after,
                _ => None,
            };
            with_connection(&app, |connection| {
                store::mark_source_error(connection, source.id(), &message, retry_after)
            })?;
            let _ = app.emit("source-status", format!("{}:error", source.id()));
            return Err(message);
        }
    };
    with_connection(&app, |connection| {
        store::append_source_records(connection, &records)?;
        store::mark_source_success(
            connection,
            source.id(),
            source.name(),
            Utc::now(),
            source.id() == "fixture-corn",
            source.cadence().seconds(),
        )
    })?;
    let changed: Vec<String> = records
        .iter()
        .map(|record| match record {
            crate::core::SourceRecord::Price(row) => row.series_id.0.clone(),
            crate::core::SourceRecord::Metric(row) => row.series_id.0.clone(),
        })
        .collect();
    app.emit("data-updated", changed)
        .map_err(|error| format!("Notify price panels: {error}"))?;
    app.emit("source-status", format!("{source_id}:ok"))
        .map_err(|error| format!("Notify source status: {error}"))
}

pub fn due_sources(app: &AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<DbState>();
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::due_sources(&connection, Utc::now())
}

/// Flags unusual daily moves for a commodity and lists possible drivers for each, newest first.
#[tauri::command]
pub fn explain_moves(
    state: State<'_, DbState>,
    commodity: String,
    threshold_sd: Option<f64>,
) -> Result<Vec<MoveExplanation>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    explain_commodity_moves(
        &connection,
        &commodity.to_ascii_uppercase(),
        threshold_sd.unwrap_or(moves::DEFAULT_THRESHOLD_SD),
    )
}

fn explain_commodity_moves(
    connection: &Connection,
    symbol: &str,
    threshold_sd: f64,
) -> Result<Vec<MoveExplanation>, String> {
    let series_id = format!("price.{symbol}.close");
    let mut bars = store::query_series(connection, &series_id, None, None, None)?;
    if bars.is_empty() && symbol == "ZC" {
        bars = store::query_series(connection, "demo.price.ZC.close", None, None, None)?;
    }
    let closes: Vec<PricePoint> = bars
        .iter()
        .map(|bar| PricePoint {
            date: bar.period,
            close: bar.close,
        })
        .collect();
    let flagged = moves::detect_moves(&closes, moves::DEFAULT_WINDOW, threshold_sd);
    let (Some(first), Some(last)) = (flagged.first(), flagged.last()) else {
        return Ok(Vec::new());
    };
    let from = crate::analytics::alignment::market_close(first.previous_date);
    let to = crate::analytics::alignment::market_close(last.date);
    let events = store::list_events_between(connection, from, to)?;
    let news = store::list_news_between(connection, symbol, from, to)?;
    let mut explanations: Vec<_> = flagged
        .iter()
        .map(|price_move| attribution::explain(price_move, symbol, &events, &news))
        .collect();
    explanations.reverse();
    Ok(explanations)
}

/// Compares top-ranked drivers with the labels in `backtest-labels.json` in the app data directory.
#[tauri::command]
pub fn run_backtest(app: AppHandle) -> Result<BacktestReport, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Find app data directory: {error}"))?
        .join("backtest-labels.json");
    let text = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "Read {}: {error}. See docs/backtest.md for the label format.",
            path.display()
        )
    })?;
    let file: LabelFile =
        serde_json::from_str(&text).map_err(|error| format!("Parse backtest labels: {error}"))?;
    with_connection(&app, |connection| {
        let mut explanations = Vec::new();
        let mut symbols: Vec<_> = file
            .labels
            .iter()
            .map(|label| label.symbol.clone())
            .collect();
        symbols.sort();
        symbols.dedup();
        for symbol in symbols {
            // Labeled dates may be mild moves, so detect at a low threshold.
            for explanation in explain_commodity_moves(connection, &symbol, 1.0)? {
                explanations.push((symbol.clone(), explanation));
            }
        }
        Ok(backtest::evaluate(&file.labels, &explanations))
    })
}

#[tauri::command]
pub fn get_setting(state: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::get_setting(&connection, &key)
}

#[tauri::command]
pub fn set_setting(state: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::set_setting(&connection, &key, &value)
}

/// Price, crop condition against its five-year range, and drought on one timeline.
#[tauri::command]
pub fn crop_stress_timeline(
    state: State<'_, DbState>,
    commodity: String,
) -> Result<Vec<StressPoint>, String> {
    let symbol = commodity.to_ascii_uppercase();
    let config = crop_region_config()?;
    let states = config.commodities.get(&symbol).cloned().unwrap_or_default();
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    let mut prices = store::query_series(
        &connection,
        &format!("price.{symbol}.close"),
        None,
        None,
        None,
    )?;
    if prices.is_empty() && symbol == "ZC" {
        prices = store::query_series(&connection, "demo.price.ZC.close", None, None, None)?;
    }
    let condition = store::query_metric_revisions(
        &connection,
        &format!("nass.{}.condition.good_excellent", symbol.to_lowercase()),
    )?;
    let drought = states
        .iter()
        .map(|state_id| {
            store::query_metric_revisions(&connection, &format!("drought.{state_id}.D1"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(combined::crop_stress_timeline(
        &prices, &condition, &drought,
    ))
}
