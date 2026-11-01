//! Tauri commands. Every command that is not `async` is declared `#[tauri::command(async)]`: Tauri
//! otherwise runs it on the main thread, where waiting on the database lock, a query, an export or
//! the keychain freezes every window.

use std::sync::Mutex;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    alerts::{self, AlertRecord, PriceAlert, river::RiverAlertRecord},
    analytics::{
        attribution::{self, MoveExplanation},
        backtest::{self, BacktestReport, LabelFile},
        combined::{self, StressPoint},
        moves::{self, PricePoint},
        river,
    },
    core::{DataSource, MetricObservation, Observation, SourceStatus, StoredRows, StoredSeries},
    plugins::{self, registry::PluginSummary},
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

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn list_sources(state: State<'_, DbState>) -> Result<Vec<SourceStatus>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_sources(&connection)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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
#[tauri::command(async)]
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
#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn save_secret(id: String, value: String) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Secret cannot be empty".into());
    }
    keyring::Entry::new("uk.billymcdowell.agri-terminal", &id)
        .map_err(|error| error.to_string())?
        .set_password(value)
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn get_secret_status(id: String) -> bool {
    keyring::Entry::new("uk.billymcdowell.agri-terminal", &id)
        .and_then(|entry| entry.get_password())
        .is_ok()
}

#[tauri::command(async)]
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

fn plugin_directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(data_directory(app)?.join("plugins"))
}

/// Built-in connectors first, then manifest plugins.
fn resolve_source(app: &AppHandle, id: &str) -> Result<Box<dyn DataSource>, String> {
    let built_in: Option<Box<dyn DataSource>> = match id {
        "fixture-corn" => Some(Box::new(crate::sources::fixture::CornFixtureSource)),
        "massive" => Some(Box::new(crate::sources::massive::MassiveSource)),
        "cftc-cot" => Some(Box::new(crate::sources::fundamentals::CftcSource)),
        "usda-nass" => Some(Box::new(crate::sources::fundamentals::NassSource)),
        "usda-fas" => Some(Box::new(crate::sources::fundamentals::FasSource)),
        _ => None,
    };
    if let Some(source) = built_in {
        return Ok(source);
    }
    use crate::sources::{agtransport, river};
    if id == agtransport::AGTRANSPORT_SOURCE {
        return Ok(Box::new(agtransport::AgTransportSource {
            config: waterways_config(app)?,
        }));
    }
    if id == river::NWPS_STAGE_SOURCE || id == river::NWPS_FORECAST_SOURCE {
        let config = waterways_config(app)?;
        return with_connection(app, |connection| {
            // The archive is only asked for days the store does not have yet.
            let mut stored = std::collections::BTreeMap::new();
            for (_, gauge) in config.gauges() {
                for series in [gauge.stage_series(), gauge.forecast_series()] {
                    let periods = store::metric_periods(connection, &series)?;
                    stored.insert(series, periods.into_iter().collect());
                }
            }
            let stored = |series: &str| stored.get(series).cloned().unwrap_or_default();
            Ok(if id == river::NWPS_STAGE_SOURCE {
                Box::new(river::NwpsStageSource::from_config(&config, stored))
                    as Box<dyn DataSource>
            } else {
                Box::new(river::NwpsForecastSource::from_config(&config, stored))
            })
        });
    }
    crate::plugins::registry::find_source(&plugin_directory(app)?, id)
        .ok_or_else(|| format!("Unknown source: {id}"))
}

/// The waterways file from the app data directory, or the bundled copy.
pub(crate) fn waterways_config(
    app: &AppHandle,
) -> Result<crate::sources::river::WaterwaysConfig, String> {
    crate::sources::river::load_waterways(&data_directory(app)?)
}

#[tauri::command]
pub async fn test_connection(app: AppHandle, source_id: String) -> Result<(), String> {
    if source_id == "fixture-corn" {
        return Err(format!("Source {source_id} has no connection test"));
    }
    resolve_source(&app, &source_id)?
        .fetch()
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn list_workspaces(state: State<'_, DbState>) -> Result<Vec<(String, String, String)>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_workspaces(&connection)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn delete_workspace(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::delete_workspace(&connection, &id)
}

#[tauri::command]
pub async fn refresh_source(app: AppHandle, source_id: String) -> Result<(), String> {
    let source = resolve_source(&app, &source_id)?;
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
    let prices_changed = records
        .iter()
        .any(|record| matches!(record, crate::core::SourceRecord::Price(_)));
    let river_changed = changed.iter().any(|id| id.starts_with("river."));
    app.emit("data-updated", changed)
        .map_err(|error| format!("Notify price panels: {error}"))?;
    if prices_changed {
        evaluate_alerts(&app)?;
    }
    if river_changed && let Err(error) = evaluate_river_alerts(&app) {
        // The data is stored; a broken waterways file should not turn the refresh into a failure.
        tracing::warn!(%error, "Could not evaluate river alerts");
    }
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
#[tauri::command(async)]
pub fn explain_moves(
    app: AppHandle,
    commodity: String,
    threshold_sd: Option<f64>,
) -> Result<Vec<MoveExplanation>, String> {
    let config = waterways_config(&app)?;
    with_connection(&app, |connection| {
        explain_commodity_moves(
            connection,
            &config,
            &commodity.to_ascii_uppercase(),
            threshold_sd.unwrap_or(moves::DEFAULT_THRESHOLD_SD),
        )
    })
}

/// River crossings, band changes and freight jumps at every gauge up to `until`.
fn river_events_until(
    connection: &Connection,
    config: &crate::sources::river::WaterwaysConfig,
    until: NaiveDate,
) -> Result<Vec<river::RiverEvent>, String> {
    let mut events = Vec::new();
    for (river_config, gauge) in config.gauges() {
        let stored = StoredGaugeSeries::load(connection, river_config, gauge)?;
        let points = river::river_timeline(
            river_config,
            gauge,
            &config.bands,
            &stored.view(),
            &[],
            until,
        );
        let location = gauge.barge_location.as_ref().and_then(|id| {
            river_config
                .barge_locations
                .iter()
                .find(|location| &location.id == id)
                .map(|location| location.name.as_str())
        });
        events.extend(river::river_events(gauge, location, &points));
    }
    Ok(events)
}

fn explain_commodity_moves(
    connection: &Connection,
    config: &crate::sources::river::WaterwaysConfig,
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
    let river_events = river_events_until(connection, config, last.date)?;
    let mut explanations: Vec<_> = flagged
        .iter()
        .map(|price_move| attribution::explain(price_move, symbol, &events, &news, &river_events))
        .collect();
    explanations.reverse();
    Ok(explanations)
}

/// Compares top-ranked drivers with the labels in `backtest-labels.json` in the app data directory.
#[tauri::command(async)]
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
    let config = waterways_config(&app)?;
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
            for explanation in explain_commodity_moves(connection, &config, &symbol, 1.0)? {
                explanations.push((symbol.clone(), explanation));
            }
        }
        Ok(backtest::evaluate(&file.labels, &explanations))
    })
}

#[tauri::command(async)]
pub fn get_setting(state: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::get_setting(&connection, &key)
}

#[tauri::command(async)]
pub fn set_setting(state: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::set_setting(&connection, &key, &value)
}

/// Price, crop condition against its five-year range, and drought on one timeline.
#[tauri::command(async)]
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

/// Every stored revision a gauge's constraint score needs.
struct StoredGaugeSeries {
    stage: Vec<MetricObservation>,
    forecast: Vec<MetricObservation>,
    barge_rate: Vec<MetricObservation>,
    locks: Vec<Vec<MetricObservation>>,
}

impl StoredGaugeSeries {
    fn load(
        connection: &Connection,
        river: &crate::sources::river::River,
        gauge: &crate::sources::river::Gauge,
    ) -> Result<Self, String> {
        let barge_series = gauge.barge_location.as_ref().and_then(|id| {
            river
                .barge_locations
                .iter()
                .find(|location| &location.id == id)
                .map(|location| location.series())
        });
        Ok(Self {
            stage: store::query_metric_revisions(connection, &gauge.stage_series())?,
            forecast: store::query_metric_revisions(connection, &gauge.forecast_series())?,
            barge_rate: match barge_series {
                Some(series) => store::query_metric_revisions(connection, &series)?,
                None => Vec::new(),
            },
            locks: river
                .locks
                .iter()
                .filter(|lock| gauge.locks.contains(&lock.id))
                .map(|lock| store::query_metric_revisions(connection, &lock.series()))
                .collect::<Result<_, _>>()?,
        })
    }

    fn view(&self) -> river::GaugeSeries<'_> {
        river::GaugeSeries {
            stage: &self.stage,
            forecast: &self.forecast,
            barge_rate: &self.barge_rate,
            locks: self.locks.iter().map(Vec::as_slice).collect(),
        }
    }
}

/// The configured gauge, or the first one when none is named.
fn find_gauge<'a>(
    config: &'a crate::sources::river::WaterwaysConfig,
    gauge: Option<&str>,
) -> Result<
    (
        &'a crate::sources::river::River,
        &'a crate::sources::river::Gauge,
    ),
    String,
> {
    match gauge {
        Some(id) => config
            .gauge(&id.to_ascii_lowercase())
            .ok_or_else(|| format!("Unknown river gauge {id}")),
        None => config
            .gauges()
            .next()
            .ok_or_else(|| "No river gauges are configured".to_string()),
    }
}

/// Score, stage, forecast, barge rate and lock traffic for a gauge, as known now.
#[tauri::command(async)]
pub fn get_river_status(
    app: AppHandle,
    gauge: Option<String>,
) -> Result<river::RiverStatus, String> {
    let config = waterways_config(&app)?;
    let (river_config, gauge_config) = find_gauge(&config, gauge.as_deref())?;
    let stored = with_connection(&app, |connection| {
        StoredGaugeSeries::load(connection, river_config, gauge_config)
    })?;
    Ok(river::river_status(
        river_config,
        gauge_config,
        &config.bands,
        &stored.view(),
        Utc::now(),
    ))
}

/// The gauge's stage, forecast, barge rate and score day by day, with the commodity's close.
#[tauri::command(async)]
pub fn get_river_timeline(
    app: AppHandle,
    gauge: Option<String>,
    commodity: String,
) -> Result<Vec<river::RiverPoint>, String> {
    let config = waterways_config(&app)?;
    let (river_config, gauge_config) = find_gauge(&config, gauge.as_deref())?;
    let symbol = commodity.to_ascii_uppercase();
    let (stored, prices) = with_connection(&app, |connection| {
        let stored = StoredGaugeSeries::load(connection, river_config, gauge_config)?;
        let mut prices = store::query_series(
            connection,
            &format!("price.{symbol}.close"),
            None,
            None,
            None,
        )?;
        if prices.is_empty() && symbol == "ZC" {
            prices = store::query_series(connection, "demo.price.ZC.close", None, None, None)?;
        }
        Ok((stored, prices))
    })?;
    Ok(river::river_timeline(
        river_config,
        gauge_config,
        &config.bands,
        &stored.view(),
        &prices,
        Utc::now().date_naive(),
    ))
}

/// Every river alert rule with its switch and state.
#[tauri::command(async)]
pub fn list_river_alerts(app: AppHandle) -> Result<Vec<RiverAlertRecord>, String> {
    let config = waterways_config(&app)?;
    let stored = with_connection(&app, store::river_alert_states)?;
    Ok(alerts::river::rules(&config, &stored))
}

#[tauri::command(async)]
pub fn set_river_alert_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let config = waterways_config(&app)?;
    if !alerts::river::rules(&config, &Default::default())
        .iter()
        .any(|record| record.id == id)
    {
        return Err(format!("Unknown river alert {id}"));
    }
    with_connection(&app, |connection| {
        store::set_river_alert_enabled(connection, &id, enabled)
    })?;
    evaluate_river_alerts(&app)
}

/// Checks every river alert against each gauge's current status and emits `river-alert-fired`
/// for each one that newly fires.
fn evaluate_river_alerts(app: &AppHandle) -> Result<(), String> {
    let config = waterways_config(app)?;
    let now = Utc::now();
    let fired = with_connection(app, |connection| {
        let mut statuses = std::collections::HashMap::new();
        for (river_config, gauge) in config.gauges() {
            let stored = StoredGaugeSeries::load(connection, river_config, gauge)?;
            statuses.insert(
                gauge.id.clone(),
                river::river_status(river_config, gauge, &config.bands, &stored.view(), now),
            );
        }
        let records = alerts::river::rules(&config, &store::river_alert_states(connection)?);
        let mut fired = Vec::new();
        for change in alerts::river::evaluate(&records, &statuses) {
            store::set_river_alert_state(connection, &change.id, change.state)?;
            fired.extend(change.fired);
        }
        Ok(fired)
    })?;
    for alert in fired {
        app.emit("river-alert-fired", alert)
            .map_err(|error| format!("Notify river alert: {error}"))?;
    }
    Ok(())
}

/// Checks every enabled price alert against the newest stored closes and emits `alert-fired`
/// for each one that newly crosses its threshold.
fn evaluate_alerts(app: &AppHandle) -> Result<(), String> {
    let fired = with_connection(app, |connection| {
        let records = store::list_alerts(connection)?;
        let mut latest = std::collections::HashMap::new();
        for symbol in ["ZC", "ZS", "ZW"] {
            let bars = store::query_series(
                connection,
                &format!("price.{symbol}.close"),
                None,
                None,
                None,
            )?;
            if let Some(bar) = bars.last() {
                latest.insert(symbol.to_string(), (bar.period, bar.close));
            }
        }
        let mut fired = Vec::new();
        for change in alerts::evaluate(&records, &latest) {
            store::set_alert_triggered(connection, &change.id, change.triggered)?;
            fired.extend(change.fired);
        }
        Ok(fired)
    })?;
    for alert in fired {
        app.emit("alert-fired", alert)
            .map_err(|error| format!("Notify alert: {error}"))?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn list_alerts(state: State<'_, DbState>) -> Result<Vec<AlertRecord>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_alerts(&connection)
}

#[tauri::command(async)]
pub fn save_alert(app: AppHandle, alert: PriceAlert) -> Result<(), String> {
    alerts::validate(&alert)?;
    with_connection(&app, |connection| store::save_alert(connection, &alert))?;
    evaluate_alerts(&app)
}

#[tauri::command(async)]
pub fn delete_alert(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::delete_alert(&connection, &id)
}

#[tauri::command(async)]
pub fn set_alert_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    with_connection(&app, |connection| {
        store::set_alert_enabled(connection, &id, enabled)
    })?;
    evaluate_alerts(&app)
}

fn data_directory(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Find app data directory: {error}"))
}

#[tauri::command(async)]
pub fn get_data_directory(app: AppHandle) -> Result<String, String> {
    Ok(data_directory(&app)?.display().to_string())
}

#[tauri::command(async)]
pub fn list_series(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_series_ids(&connection)
}

/// Every stored series grouped by the source that wrote it, for the raw data panel.
#[tauri::command(async)]
pub fn list_stored_series(state: State<'_, DbState>) -> Result<Vec<StoredSeries>, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::list_stored_series(&connection)
}

/// Every stored revision of a series exactly as saved, with no demo fallback.
#[tauri::command(async)]
pub fn get_stored_rows(state: State<'_, DbState>, series_id: String) -> Result<StoredRows, String> {
    let connection = state
        .0
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    store::query_stored_rows(&connection, &series_id)
}

/// Writes every stored revision of a series to `exports/<series>.csv` and returns the path.
#[tauri::command(async)]
pub fn export_series_csv(app: AppHandle, series_id: String) -> Result<String, String> {
    let csv = with_connection(&app, |connection| {
        if series_id.contains("price.") {
            crate::export::prices_to_csv(&store::query_series(
                connection, &series_id, None, None, None,
            )?)
        } else {
            crate::export::metrics_to_csv(&store::query_metric_revisions(connection, &series_id)?)
        }
    })?;
    let path = crate::export::write_export(
        &data_directory(&app)?.join("exports"),
        &format!("{series_id}.csv"),
        &csv,
    )?;
    Ok(path.display().to_string())
}

/// Writes a saved workspace's layout JSON to `exports/workspace-<id>.json`.
#[tauri::command(async)]
pub fn export_workspace(app: AppHandle, id: String) -> Result<String, String> {
    let json = with_connection(&app, |connection| {
        store::list_workspaces(connection)?
            .into_iter()
            .find(|(saved_id, _, _)| *saved_id == id)
            .map(|(_, _, json)| json)
            .ok_or_else(|| format!("No saved workspace {id}"))
    })?;
    let path = crate::export::write_export(
        &data_directory(&app)?.join("exports"),
        &format!("workspace-{id}.json"),
        &json,
    )?;
    Ok(path.display().to_string())
}

#[tauri::command(async)]
pub fn list_plugins(app: AppHandle) -> Result<Vec<PluginSummary>, String> {
    Ok(plugins::registry::load_all(&plugin_directory(&app)?)
        .into_iter()
        .map(|loaded| loaded.summary)
        .collect())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPreview {
    pub errors: Vec<String>,
    pub summary: Option<PluginSummary>,
}

/// Validates pasted manifest text without installing it, so permissions can be reviewed first.
#[tauri::command(async)]
pub fn preview_plugin(manifest: String) -> PluginPreview {
    match plugins::manifest::load(&manifest, false) {
        Ok(parsed) => PluginPreview {
            errors: Vec::new(),
            summary: Some(plugins::registry::PluginSummary::of(&parsed)),
        },
        Err(errors) => PluginPreview {
            errors,
            summary: None,
        },
    }
}

/// Installs a plugin switched off. It runs only after the user has reviewed its permissions and enabled it.
#[tauri::command(async)]
pub fn install_plugin(app: AppHandle, manifest: String) -> Result<PluginSummary, String> {
    let installed = plugins::registry::install(&plugin_directory(&app)?, &manifest)
        .map_err(|errors| errors.join("\n"))?;
    with_connection(&app, |connection| {
        store::register_source(
            connection,
            &installed.id,
            &installed.name,
            if installed.source.cadence == "daily" {
                86_400
            } else {
                604_800
            },
            false,
        )
    })?;
    Ok(plugins::registry::PluginSummary::of(&installed))
}

#[tauri::command(async)]
pub fn remove_plugin(app: AppHandle, id: String) -> Result<(), String> {
    plugins::registry::remove(&plugin_directory(&app)?, &id)?;
    with_connection(&app, |connection| store::delete_source(connection, &id))
}

#[tauri::command(async)]
pub fn save_plugin_secret(
    app: AppHandle,
    plugin_id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    let loaded = plugins::registry::load_all(&plugin_directory(&app)?);
    let manifest = loaded
        .into_iter()
        .find_map(|item| item.manifest.filter(|manifest| manifest.id == plugin_id))
        .ok_or_else(|| format!("No plugin {plugin_id}"))?;
    if !manifest.permissions.secrets.contains(&name) {
        return Err(format!("{plugin_id} did not declare a secret named {name}"));
    }
    if value.trim().is_empty() {
        return Err("Secret cannot be empty".into());
    }
    plugins::source::save_secret(&plugin_id, &name, &value)
}

/// A plugin that needs a secret is skipped by the scheduler until the secret is saved.
pub fn plugin_is_configured(app: &AppHandle, id: &str) -> bool {
    let Ok(directory) = plugin_directory(app) else {
        return true;
    };
    plugins::registry::load_all(&directory)
        .into_iter()
        .find_map(|item| item.manifest.filter(|manifest| manifest.id == id))
        .is_none_or(|manifest| plugins::registry::is_configured(&manifest))
}
