use std::{fs, path::Path};

use chrono::{DateTime, Datelike, NaiveDate, Utc, Weekday};
use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    alerts::{AlertRecord, PriceAlert},
    core::{
        CalendarEvent, MetricObservation, NewsItem, Observation, SeriesId, SourceId, SourceRecord,
        SourceStatus, Unit, WeatherForecast, WeatherSnapshot,
    },
    sources::fixture::corn_daily_fixture,
};

const DEMO_SERIES_ID: &str = "demo.price.ZC.close";

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Create app data directory: {error}"))?;
    }

    let connection =
        Connection::open(path).map_err(|error| format!("Open local database: {error}"))?;
    migrate(&connection)?;
    seed_fixture_if_empty(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), String> {
    let version: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("Read database version: {error}"))?;

    if version < 1 {
        connection
            .execute_batch(
                "BEGIN;
                CREATE TABLE observations (
                    series_id TEXT NOT NULL,
                    period TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    released_at TEXT NOT NULL,
                    open REAL NOT NULL,
                    high REAL NOT NULL,
                    low REAL NOT NULL,
                    close REAL NOT NULL,
                    unit TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (series_id, period, revision)
                );
                CREATE INDEX observations_series_period ON observations(series_id, period);
                CREATE TABLE source_status (
                    source_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    state TEXT NOT NULL,
                    last_ok TEXT,
                    error TEXT,
                    is_demo INTEGER NOT NULL DEFAULT 0
                );
                PRAGMA user_version = 1;
                COMMIT;",
            )
            .map_err(|error| format!("Create database schema: {error}"))?;
    }
    if version < 2 {
        connection.execute_batch(
            "BEGIN;
            CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
            PRAGMA user_version = 2;
            COMMIT;",
        ).map_err(|error| format!("Create workspace schema: {error}"))?;
    }
    if version < 3 {
        connection.execute_batch(
            "BEGIN;
            CREATE TABLE metric_observations (
                series_id TEXT NOT NULL, period TEXT NOT NULL, revision INTEGER NOT NULL,
                released_at TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
                source_id TEXT NOT NULL, fetched_at TEXT NOT NULL,
                PRIMARY KEY (series_id, period, revision)
            );
            CREATE INDEX metric_series_period ON metric_observations(series_id, period);
            CREATE TABLE events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, scheduled_at TEXT NOT NULL, commodity TEXT, title TEXT NOT NULL);
            PRAGMA user_version = 3;
            COMMIT;",
        ).map_err(|error| format!("Create core data schema: {error}"))?;
    }
    if version < 4 {
        connection
            .execute_batch(
                "BEGIN;
            ALTER TABLE source_status ADD COLUMN last_attempt TEXT;
            ALTER TABLE source_status ADD COLUMN next_expected TEXT;
            ALTER TABLE source_status ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE source_status ADD COLUMN cadence_seconds INTEGER NOT NULL DEFAULT 604800;
            PRAGMA user_version = 4;
            COMMIT;",
            )
            .map_err(|error| format!("Add source scheduling metadata: {error}"))?;
    }
    if version < 5 {
        connection
            .execute_batch(
                "BEGIN;
            ALTER TABLE source_status ADD COLUMN retry_attempts INTEGER NOT NULL DEFAULT 0;
            PRAGMA user_version = 5;
            COMMIT;",
            )
            .map_err(|error| format!("Add source retry metadata: {error}"))?;
    }
    if version < 6 {
        connection
            .execute_batch(
                "BEGIN;
                CREATE TABLE news_items (
                    url TEXT PRIMARY KEY,
                    normalized_title TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    source TEXT NOT NULL,
                    published_at TEXT NOT NULL,
                    commodity TEXT NOT NULL
                );
                CREATE INDEX news_commodity_published ON news_items(commodity, published_at);
                PRAGMA user_version = 6;
                COMMIT;",
            )
            .map_err(|error| format!("Create news item schema: {error}"))?;
    }
    if version < 7 {
        connection
            .execute_batch(
                "BEGIN;
                CREATE TABLE weather_cache (
                    commodity TEXT PRIMARY KEY,
                    fetched_at TEXT NOT NULL,
                    json TEXT NOT NULL
                );
                PRAGMA user_version = 7;
                COMMIT;",
            )
            .map_err(|error| format!("Create weather cache schema: {error}"))?;
    }
    if version < 8 {
        // A story can be relevant to several commodities, so identity is (url, commodity).
        connection
            .execute_batch(
                "BEGIN;
                CREATE TABLE news_items_v8 (
                    url TEXT NOT NULL,
                    normalized_title TEXT NOT NULL,
                    title TEXT NOT NULL,
                    source TEXT NOT NULL,
                    published_at TEXT NOT NULL,
                    commodity TEXT NOT NULL,
                    PRIMARY KEY (url, commodity),
                    UNIQUE (commodity, normalized_title)
                );
                INSERT INTO news_items_v8 SELECT url, normalized_title, title, source, published_at, commodity FROM news_items;
                DROP TABLE news_items;
                ALTER TABLE news_items_v8 RENAME TO news_items;
                CREATE INDEX news_commodity_published ON news_items(commodity, published_at);
                PRAGMA user_version = 8;
                COMMIT;",
            )
            .map_err(|error| format!("Rekey news items by commodity: {error}"))?;
    }
    if version < 9 {
        connection
            .execute_batch(
                "BEGIN;
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                PRAGMA user_version = 9;
                COMMIT;",
            )
            .map_err(|error| format!("Create settings schema: {error}"))?;
    }
    if version < 10 {
        connection
            .execute_batch(
                "BEGIN;
                CREATE TABLE alerts (
                    id TEXT PRIMARY KEY,
                    json TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    triggered INTEGER NOT NULL DEFAULT 0
                );
                PRAGMA user_version = 10;
                COMMIT;",
            )
            .map_err(|error| format!("Create alerts schema: {error}"))?;
    }
    Ok(())
}

pub fn save_alert(connection: &Connection, alert: &PriceAlert) -> Result<(), String> {
    let json = serde_json::to_string(alert).map_err(|error| format!("Serialize alert: {error}"))?;
    // Editing an alert re-arms it, since its threshold may now be on the other side of the price.
    connection
        .execute(
            "INSERT INTO alerts (id, json) VALUES (?1, ?2)
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, triggered = 0",
            params![alert.id, json],
        )
        .map_err(|error| format!("Save alert: {error}"))?;
    Ok(())
}

pub fn list_alerts(connection: &Connection) -> Result<Vec<AlertRecord>, String> {
    let mut statement = connection
        .prepare("SELECT json, enabled, triggered FROM alerts ORDER BY id")
        .map_err(|error| format!("Prepare alert list: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| format!("Query alerts: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read alert: {error}"))?;
    rows.into_iter()
        .map(|(json, enabled, triggered)| {
            Ok(AlertRecord {
                alert: serde_json::from_str(&json)
                    .map_err(|error| format!("Parse stored alert: {error}"))?,
                enabled: enabled != 0,
                triggered: triggered != 0,
            })
        })
        .collect()
}

pub fn delete_alert(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM alerts WHERE id = ?1", [id])
        .map_err(|error| format!("Delete alert: {error}"))?;
    Ok(())
}

pub fn set_alert_enabled(connection: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    connection
        .execute(
            "UPDATE alerts SET enabled = ?2, triggered = 0 WHERE id = ?1",
            params![id, enabled],
        )
        .map_err(|error| format!("Update alert: {error}"))?;
    Ok(())
}

pub fn set_alert_triggered(
    connection: &Connection,
    id: &str,
    triggered: bool,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE alerts SET triggered = ?2 WHERE id = ?1",
            params![id, triggered],
        )
        .map_err(|error| format!("Update alert state: {error}"))?;
    Ok(())
}

pub fn save_weather_snapshot(
    connection: &Connection,
    commodity: &str,
    forecasts: &[WeatherForecast],
    fetched_at: DateTime<Utc>,
) -> Result<(), String> {
    let json = serde_json::to_string(forecasts)
        .map_err(|error| format!("Serialize weather forecasts: {error}"))?;
    connection
        .execute(
            "INSERT INTO weather_cache (commodity, fetched_at, json) VALUES (?1, ?2, ?3)
             ON CONFLICT(commodity) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
            params![commodity, fetched_at.to_rfc3339(), json],
        )
        .map_err(|error| format!("Save weather cache: {error}"))?;
    Ok(())
}

pub fn load_weather_snapshot(
    connection: &Connection,
    commodity: &str,
) -> Result<WeatherSnapshot, String> {
    let cached: Option<(String, String)> = connection
        .query_row(
            "SELECT fetched_at, json FROM weather_cache WHERE commodity = ?1",
            [commodity],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Read weather cache: {error}"))?;
    let Some((fetched_at, json)) = cached else {
        return Ok(WeatherSnapshot {
            fetched_at: None,
            forecasts: Vec::new(),
        });
    };
    Ok(WeatherSnapshot {
        fetched_at: Some(
            DateTime::parse_from_rfc3339(&fetched_at)
                .map_err(|error| format!("Parse weather fetch time: {error}"))?
                .with_timezone(&Utc),
        ),
        forecasts: serde_json::from_str(&json)
            .map_err(|error| format!("Parse cached weather: {error}"))?,
    })
}

pub fn save_workspace(
    connection: &Connection,
    id: &str,
    name: &str,
    json: &str,
) -> Result<(), String> {
    connection.execute(
        "INSERT INTO workspaces (id, name, json, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, updated_at = excluded.updated_at",
        params![id, name, json, Utc::now().to_rfc3339()],
    ).map_err(|error| format!("Save workspace: {error}"))?;
    Ok(())
}

pub fn list_workspaces(connection: &Connection) -> Result<Vec<(String, String, String)>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, json FROM workspaces ORDER BY name")
        .map_err(|error| format!("Prepare workspace list: {error}"))?;
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|error| format!("Query workspaces: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read workspace: {error}"))
}

pub fn append_source_records(
    connection: &Connection,
    records: &[SourceRecord],
) -> Result<usize, String> {
    let mut metrics = Vec::new();
    let mut prices = Vec::new();
    for record in records {
        match record {
            SourceRecord::Price(value) => prices.push(value.clone()),
            SourceRecord::Metric(value) => metrics.push(value.clone()),
        }
    }
    append_observations_as_revisions(connection, &prices)?;
    append_metric_revisions(connection, &metrics)
}

fn append_metric_revisions(
    connection: &Connection,
    observations: &[MetricObservation],
) -> Result<usize, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start metric transaction: {error}"))?;
    let mut inserted = 0;
    {
        let mut latest = transaction.prepare("SELECT revision, value FROM metric_observations WHERE series_id = ?1 AND period = ?2 ORDER BY revision DESC LIMIT 1").map_err(|error| format!("Prepare metric revision lookup: {error}"))?;
        let mut insert = transaction.prepare("INSERT INTO metric_observations (series_id, period, revision, released_at, value, unit, source_id, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").map_err(|error| format!("Prepare metric insert: {error}"))?;
        for observation in observations {
            let previous: Option<(i64, f64)> = latest
                .query_row(
                    params![observation.series_id.0, observation.period.to_string()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|error| format!("Read metric revision: {error}"))?;
            if previous.is_some_and(|(_, value)| value == observation.value) {
                continue;
            }
            let revision = previous.map_or(0, |(revision, _)| revision + 1);
            insert
                .execute(params![
                    observation.series_id.0,
                    observation.period.to_string(),
                    revision,
                    observation.released_at.to_rfc3339(),
                    observation.value,
                    observation.unit,
                    observation.source_id.0,
                    observation.fetched_at.to_rfc3339()
                ])
                .map_err(|error| format!("Insert metric revision: {error}"))?;
            inserted += 1;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit metric records: {error}"))?;
    Ok(inserted)
}

/// The newest revision of each period.
pub fn query_metric_series(
    connection: &Connection,
    series_id: &str,
) -> Result<Vec<MetricObservation>, String> {
    read_metric_rows(
        connection,
        "SELECT o.series_id, o.period, o.revision, o.released_at, o.value, o.unit, o.source_id, o.fetched_at FROM metric_observations o WHERE o.series_id = ?1 AND o.revision = (SELECT MAX(r.revision) FROM metric_observations r WHERE r.series_id = o.series_id AND r.period = o.period) ORDER BY o.period",
        series_id,
    )
}

/// Every stored revision, so a join can pick what was visible at a given time.
pub fn query_metric_revisions(
    connection: &Connection,
    series_id: &str,
) -> Result<Vec<MetricObservation>, String> {
    read_metric_rows(
        connection,
        "SELECT series_id, period, revision, released_at, value, unit, source_id, fetched_at FROM metric_observations WHERE series_id = ?1 ORDER BY period, revision",
        series_id,
    )
}

fn read_metric_rows(
    connection: &Connection,
    sql: &str,
    series_id: &str,
) -> Result<Vec<MetricObservation>, String> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("Prepare metric series query: {error}"))?;
    statement
        .query_map([series_id], |row| {
            let period: String = row.get(1)?;
            let parse_datetime = |index, value: String| {
                DateTime::parse_from_rfc3339(&value)
                    .map(|date| date.with_timezone(&Utc))
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            index,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })
            };
            Ok(MetricObservation {
                series_id: SeriesId(row.get(0)?),
                period: NaiveDate::parse_from_str(&period, "%Y-%m-%d").map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                revision: row.get(2)?,
                released_at: parse_datetime(3, row.get(3)?)?,
                value: row.get(4)?,
                unit: row.get(5)?,
                source_id: SourceId(row.get(6)?),
                fetched_at: parse_datetime(7, row.get(7)?)?,
            })
        })
        .map_err(|error| format!("Query metric series: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read metric series row: {error}"))
}

pub fn upsert_observations(
    connection: &Connection,
    observations: &[Observation],
) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start observation transaction: {error}"))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT OR IGNORE INTO observations
                (series_id, period, revision, released_at, open, high, low, close, unit, source_id, fetched_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )
            .map_err(|error| format!("Prepare observation insert: {error}"))?;
        for observation in observations {
            statement
                .execute(params![
                    &observation.series_id.0,
                    observation.period.to_string(),
                    observation.revision,
                    observation.released_at.to_rfc3339(),
                    observation.open,
                    observation.high,
                    observation.low,
                    observation.close,
                    observation.unit.as_str(),
                    &observation.source_id.0,
                    observation.fetched_at.to_rfc3339(),
                ])
                .map_err(|error| format!("Insert observation: {error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit observations: {error}"))
}

pub fn query_series(
    connection: &Connection,
    series_id: &str,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
    as_of: Option<DateTime<Utc>>,
) -> Result<Vec<Observation>, String> {
    let rows = connection
        .prepare(
            "SELECT o.series_id, o.period, o.released_at, o.open, o.high, o.low, o.close,
                    o.unit, o.source_id, o.fetched_at, o.revision
             FROM observations o
             WHERE o.series_id = ?1
               AND (?2 IS NULL OR o.period >= ?2)
               AND (?3 IS NULL OR o.period <= ?3)
               AND (?4 IS NULL OR o.released_at <= ?4)
               AND o.revision = (
                    SELECT MAX(latest.revision) FROM observations latest
                    WHERE latest.series_id = o.series_id
                      AND latest.period = o.period
                      AND (?4 IS NULL OR latest.released_at <= ?4)
               )
             ORDER BY o.period ASC",
        )
        .map_err(|error| format!("Prepare series query: {error}"))?
        .query_map(
            params![
                series_id,
                start.map(|date| date.to_string()),
                end.map(|date| date.to_string()),
                as_of.map(|time| time.to_rfc3339()),
            ],
            |row| {
                let period: String = row.get(1)?;
                let released_at: String = row.get(2)?;
                let fetched_at: String = row.get(9)?;
                Ok(Observation {
                    series_id: SeriesId::from(row.get::<_, String>(0)?),
                    period: NaiveDate::parse_from_str(&period, "%Y-%m-%d").map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                    released_at: DateTime::parse_from_rfc3339(&released_at)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                2,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?
                        .with_timezone(&Utc),
                    open: row.get(3)?,
                    high: row.get(4)?,
                    low: row.get(5)?,
                    close: row.get(6)?,
                    unit: {
                        let stored_unit: String = row.get(7)?;
                        Unit::from_storage(&stored_unit).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                7,
                                rusqlite::types::Type::Text,
                                Box::new(std::io::Error::new(
                                    std::io::ErrorKind::InvalidData,
                                    error,
                                )),
                            )
                        })?
                    },
                    source_id: SourceId::from(row.get::<_, String>(8)?),
                    fetched_at: DateTime::parse_from_rfc3339(&fetched_at)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                9,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?
                        .with_timezone(&Utc),
                    revision: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Query series: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read series row: {error}"))?;
    Ok(rows)
}

pub fn append_observations_as_revisions(
    connection: &Connection,
    observations: &[Observation],
) -> Result<usize, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start revision transaction: {error}"))?;
    let mut inserted = 0;
    {
        let mut latest_query = transaction
            .prepare(
                "SELECT revision, open, high, low, close FROM observations
                 WHERE series_id = ?1 AND period = ?2
                 ORDER BY revision DESC LIMIT 1",
            )
            .map_err(|error| format!("Prepare latest observation query: {error}"))?;
        let mut insert = transaction
            .prepare(
                "INSERT INTO observations
                (series_id, period, revision, released_at, open, high, low, close, unit, source_id, fetched_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )
            .map_err(|error| format!("Prepare revision insert: {error}"))?;
        for observation in observations {
            let latest: Option<(i64, f64, f64, f64, f64)> = latest_query
                .query_row(
                    params![&observation.series_id.0, observation.period.to_string()],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| format!("Read latest observation: {error}"))?;
            if latest.is_some_and(|(_, open, high, low, close)| {
                open == observation.open
                    && high == observation.high
                    && low == observation.low
                    && close == observation.close
            }) {
                continue;
            }
            let revision = latest.map_or(0, |(revision, ..)| revision + 1);
            insert
                .execute(params![
                    &observation.series_id.0,
                    observation.period.to_string(),
                    revision,
                    observation.released_at.to_rfc3339(),
                    observation.open,
                    observation.high,
                    observation.low,
                    observation.close,
                    observation.unit.as_str(),
                    &observation.source_id.0,
                    observation.fetched_at.to_rfc3339(),
                ])
                .map_err(|error| format!("Insert observation revision: {error}"))?;
            inserted += 1;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit observation revisions: {error}"))?;
    Ok(inserted)
}

pub fn mark_source_success(
    connection: &Connection,
    source_id: &str,
    name: &str,
    last_ok: DateTime<Utc>,
    is_demo: bool,
    cadence_seconds: i64,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO source_status (source_id, name, state, last_ok, error, is_demo, last_attempt, next_expected, cadence_seconds)
             VALUES (?1, ?2, 'ok', ?3, NULL, ?4, ?3, ?5, ?6)
             ON CONFLICT(source_id) DO UPDATE SET
                name = excluded.name, state = excluded.state, last_ok = excluded.last_ok,
                error = NULL, is_demo = excluded.is_demo, last_attempt = excluded.last_attempt,
                next_expected = excluded.next_expected, cadence_seconds = excluded.cadence_seconds, retry_attempts = 0",
            params![source_id, name, last_ok.to_rfc3339(), is_demo, (last_ok + chrono::Duration::seconds(cadence_seconds)).to_rfc3339(), cadence_seconds],
        )
        .map_err(|error| format!("Update source status: {error}"))?;
    Ok(())
}

pub fn mark_source_error(
    connection: &Connection,
    source_id: &str,
    error: &str,
    retry_after: Option<DateTime<Utc>>,
) -> Result<(), String> {
    let current: Option<(i64, i64)> = connection
        .query_row(
            "SELECT retry_attempts, cadence_seconds FROM source_status WHERE source_id = ?1",
            [source_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|db_error| format!("Read source retry state: {db_error}"))?;
    let attempts = current.map_or(1, |(attempts, _)| (attempts + 1).min(8));
    let cadence_seconds = current.map_or(604_800, |(_, cadence)| cadence);
    let now = Utc::now();
    let next_expected = crate::scheduler::retry_deadline(
        now,
        attempts as u32,
        cadence_seconds,
        retry_after,
        source_id.bytes().map(u64::from).sum(),
    )
    .to_rfc3339();
    connection
        .execute(
            "INSERT INTO source_status (source_id, name, state, error, is_demo, last_attempt, next_expected, retry_attempts)
             VALUES (?1, ?1, 'error', ?2, 0, ?3, ?4, ?5)
             ON CONFLICT(source_id) DO UPDATE SET state = 'error', error = excluded.error, last_attempt = excluded.last_attempt,
                retry_attempts = excluded.retry_attempts, next_expected = excluded.next_expected",
            params![source_id, error, now.to_rfc3339(), next_expected, attempts],
        )
        .map_err(|db_error| format!("Update source error status: {db_error}"))?;
    Ok(())
}

pub fn register_sources(connection: &Connection) -> Result<(), String> {
    for (id, name, cadence) in [
        ("databento", "Databento · GLBX.MDP3", 86_400),
        ("fixture-corn", "Corn price fixture", 86_400),
        ("cftc-cot", "CFTC Commitments of Traders", 604_800),
        ("usda-nass", "USDA NASS QuickStats", 604_800),
        ("usda-fas", "USDA FAS OpenData", 604_800),
        ("us-drought-monitor", "U.S. Drought Monitor", 604_800),
    ] {
        register_source(connection, id, name, cadence, true)?;
    }
    Ok(())
}

/// Adds a source to the status table if it is not there yet; an existing row keeps its state.
pub fn register_source(
    connection: &Connection,
    id: &str,
    name: &str,
    cadence_seconds: i64,
    enabled: bool,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO source_status (source_id, name, state, is_demo, enabled, cadence_seconds) VALUES (?1, ?2, 'idle', ?3, ?4, ?5)",
            params![id, name, id == "fixture-corn", enabled, cadence_seconds],
        )
        .map_err(|error| format!("Register source {id}: {error}"))?;
    Ok(())
}

pub fn delete_source(connection: &Connection, id: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM source_status WHERE source_id = ?1", [id])
        .map_err(|error| format!("Remove source {id}: {error}"))?;
    Ok(())
}

pub fn set_source_enabled(
    connection: &Connection,
    source_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let changed = connection
        .execute(
            "UPDATE source_status SET enabled = ?2 WHERE source_id = ?1",
            params![source_id, enabled],
        )
        .map_err(|error| format!("Set source enabled state: {error}"))?;
    if changed == 0 {
        return Err(format!("Unknown source: {source_id}"));
    }
    Ok(())
}

pub fn due_sources(connection: &Connection, now: DateTime<Utc>) -> Result<Vec<String>, String> {
    let mut statement = connection.prepare("SELECT source_id FROM source_status WHERE enabled = 1 AND (next_expected IS NULL OR next_expected <= ?1) ORDER BY COALESCE(next_expected, '0000-01-01T00:00:00Z')")
        .map_err(|error| format!("Prepare due source query: {error}"))?;
    statement
        .query_map([now.to_rfc3339()], |row| row.get(0))
        .map_err(|error| format!("Query due sources: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read due source: {error}"))
}

#[derive(serde::Deserialize)]
struct CalendarConfig {
    schedules: Vec<CalendarSchedule>,
}
#[derive(serde::Deserialize)]
struct CalendarSchedule {
    id: String,
    title: String,
    kind: String,
    cadence: String,
    weekday: Option<u32>,
    day: Option<u32>,
    hour_utc: u32,
    minute_utc: u32,
    start_month: Option<u32>,
    end_month: Option<u32>,
    commodity: Option<String>,
}

pub fn seed_report_calendar(connection: &Connection, config: &str) -> Result<(), String> {
    let config: CalendarConfig = serde_json::from_str(config)
        .map_err(|error| format!("Parse report calendar configuration: {error}"))?;
    let now = Utc::now();
    // Events are generated entirely from the config, so regenerate all of them to pick up edits.
    connection
        .execute("DELETE FROM events", [])
        .map_err(|error| format!("Clear generated report calendar: {error}"))?;
    for event in generate_calendar_events(&config, now) {
        connection.execute("INSERT OR IGNORE INTO events (id, kind, scheduled_at, commodity, title) VALUES (?1, ?2, ?3, ?4, ?5)", params![event.id, event.kind, event.scheduled_at.to_rfc3339(), event.commodity, event.title]).map_err(|error| format!("Seed report calendar: {error}"))?;
    }
    Ok(())
}

/// Days of past releases generated so moves can be matched to the schedule they landed on.
const CALENDAR_LOOKBACK_DAYS: i64 = 400;
/// Days ahead that upcoming releases are generated.
const CALENDAR_HORIZON_DAYS: i64 = 120;

/// Generates every release between the lookback and the horizon from the schedule rules.
fn generate_calendar_events(config: &CalendarConfig, now: DateTime<Utc>) -> Vec<CalendarEvent> {
    let first = (now - chrono::Duration::days(CALENDAR_LOOKBACK_DAYS)).date_naive();
    let last = (now + chrono::Duration::days(CALENDAR_HORIZON_DAYS)).date_naive();
    let mut events = Vec::new();
    for schedule in &config.schedules {
        let mut push = |date: NaiveDate| {
            let Some(time) = date.and_hms_opt(schedule.hour_utc, schedule.minute_utc, 0) else {
                return;
            };
            events.push(CalendarEvent {
                id: format!("{}-{}", schedule.id, date),
                kind: schedule.kind.clone(),
                scheduled_at: time.and_utc(),
                commodity: schedule.commodity.clone(),
                title: schedule.title.clone(),
            });
        };
        if schedule.cadence == "weekly" {
            let target = weekday(schedule.weekday.unwrap_or(0));
            let delta = (target.num_days_from_monday() as i64
                - first.weekday().num_days_from_monday() as i64)
                .rem_euclid(7);
            let mut date = first + chrono::Duration::days(delta);
            while date <= last {
                let in_season = schedule
                    .start_month
                    .is_none_or(|month| date.month() >= month)
                    && schedule.end_month.is_none_or(|month| date.month() <= month);
                if in_season {
                    push(date);
                }
                date += chrono::Duration::days(7);
            }
        } else if schedule.cadence == "monthly" {
            let (mut year, mut month) = (first.year(), first.month());
            while NaiveDate::from_ymd_opt(year, month, 1).is_some_and(|start| start <= last) {
                let day = schedule.day.unwrap_or(1).min(days_in_month(year, month));
                if let Some(date) = NaiveDate::from_ymd_opt(year, month, day)
                    && date >= first
                    && date <= last
                {
                    push(date);
                }
                if month == 12 {
                    year += 1;
                    month = 1;
                } else {
                    month += 1;
                }
            }
        }
    }
    events.sort_by_key(|event| event.scheduled_at);
    events
}
fn weekday(day: u32) -> Weekday {
    match day % 7 {
        0 => Weekday::Mon,
        1 => Weekday::Tue,
        2 => Weekday::Wed,
        3 => Weekday::Thu,
        4 => Weekday::Fri,
        5 => Weekday::Sat,
        _ => Weekday::Sun,
    }
}
fn days_in_month(year: i32, month: u32) -> u32 {
    (28..=31)
        .rev()
        .find(|day| NaiveDate::from_ymd_opt(year, month, *day).is_some())
        .unwrap_or(28)
}

fn query_events(
    connection: &Connection,
    sql: &str,
    bounds: &[String],
) -> Result<Vec<CalendarEvent>, String> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("Prepare calendar query: {error}"))?;
    statement
        .query_map(rusqlite::params_from_iter(bounds), |row| {
            let scheduled: String = row.get(2)?;
            Ok(CalendarEvent {
                id: row.get(0)?,
                kind: row.get(1)?,
                scheduled_at: DateTime::parse_from_rfc3339(&scheduled)
                    .map(|time| time.with_timezone(&Utc))
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                commodity: row.get(3)?,
                title: row.get(4)?,
            })
        })
        .map_err(|error| format!("Query calendar: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read calendar event: {error}"))
}

/// Upcoming releases, soonest first.
pub fn list_calendar_events(
    connection: &Connection,
    from: DateTime<Utc>,
) -> Result<Vec<CalendarEvent>, String> {
    query_events(
        connection,
        "SELECT id, kind, scheduled_at, commodity, title FROM events WHERE scheduled_at >= ?1 ORDER BY scheduled_at LIMIT 100",
        &[from.to_rfc3339()],
    )
}

/// Every release in a closed time range, for matching against price moves.
pub fn list_events_between(
    connection: &Connection,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<CalendarEvent>, String> {
    query_events(
        connection,
        "SELECT id, kind, scheduled_at, commodity, title FROM events WHERE scheduled_at >= ?1 AND scheduled_at <= ?2 ORDER BY scheduled_at",
        &[from.to_rfc3339(), to.to_rfc3339()],
    )
}

pub fn save_news_items(connection: &Connection, items: &[NewsItem]) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start news transaction: {error}"))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT OR IGNORE INTO news_items (url, normalized_title, title, source, published_at, commodity)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|error| format!("Prepare news insert: {error}"))?;
        for item in items {
            let normalized_title = item
                .title
                .to_lowercase()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            statement
                .execute(params![
                    item.url,
                    normalized_title,
                    item.title,
                    item.source,
                    item.published_at.to_rfc3339(),
                    item.commodity,
                ])
                .map_err(|error| format!("Insert news item: {error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit news items: {error}"))
}

pub fn list_news_items(connection: &Connection, commodity: &str) -> Result<Vec<NewsItem>, String> {
    let mut statement = connection
        .prepare(
            "SELECT title, source, published_at, url, commodity FROM news_items
             WHERE commodity = ?1 ORDER BY published_at DESC LIMIT 100",
        )
        .map_err(|error| format!("Prepare news query: {error}"))?;
    statement
        .query_map([commodity], |row| {
            let published_at: String = row.get(2)?;
            Ok(NewsItem {
                title: row.get(0)?,
                source: row.get(1)?,
                published_at: DateTime::parse_from_rfc3339(&published_at)
                    .map(|date| date.with_timezone(&Utc))
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                url: row.get(3)?,
                commodity: row.get(4)?,
            })
        })
        .map_err(|error| format!("Query news: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read news row: {error}"))
}

pub fn list_news_between(
    connection: &Connection,
    commodity: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<NewsItem>, String> {
    let mut items = list_news_items(connection, commodity)?;
    items.retain(|item| item.published_at >= from && item.published_at <= to);
    Ok(items)
}

/// Every series id with stored observations, for the export list.
pub fn list_series_ids(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT series_id FROM observations UNION SELECT DISTINCT series_id FROM metric_observations ORDER BY 1",
        )
        .map_err(|error| format!("Prepare series list: {error}"))?;
    statement
        .query_map([], |row| row.get(0))
        .map_err(|error| format!("Query series list: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read series id: {error}"))
}

pub fn get_setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|error| format!("Read setting {key}: {error}"))
}

pub fn set_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|error| format!("Save setting {key}: {error}"))?;
    Ok(())
}

pub fn list_sources(connection: &Connection) -> Result<Vec<SourceStatus>, String> {
    let mut statement = connection
        .prepare("SELECT source_id, name, state, last_ok, error, is_demo, last_attempt, next_expected, enabled, cadence_seconds FROM source_status ORDER BY name")
        .map_err(|error| format!("Prepare source query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let last_ok: Option<String> = row.get(3)?;
            let last_attempt: Option<String> = row.get(6)?;
            let next_expected: Option<String> = row.get(7)?;
            let parse_time = |index, value: Option<String>| {
                value
                    .map(|value| {
                        DateTime::parse_from_rfc3339(&value).map(|time| time.with_timezone(&Utc))
                    })
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            index,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })
            };
            Ok(SourceStatus {
                source_id: SourceId::from(row.get::<_, String>(0)?),
                name: row.get(1)?,
                state: row.get(2)?,
                last_ok: last_ok
                    .map(|value| {
                        DateTime::parse_from_rfc3339(&value).map(|time| time.with_timezone(&Utc))
                    })
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                error: row.get(4)?,
                is_demo: row.get::<_, i64>(5)? != 0,
                last_attempt: parse_time(6, last_attempt)?,
                next_expected: parse_time(7, next_expected)?,
                enabled: row.get::<_, i64>(8)? != 0,
                cadence_seconds: row.get(9)?,
            })
        })
        .map_err(|error| format!("Query sources: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read source row: {error}"))?;
    Ok(rows)
}

fn seed_fixture_if_empty(connection: &Connection) -> Result<(), String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM observations WHERE series_id = ?1",
            [DEMO_SERIES_ID],
            |row| row.get(0),
        )
        .map_err(|error| format!("Check fixture data: {error}"))?;
    if count == 0 {
        let observations = corn_daily_fixture()?;
        upsert_observations(connection, &observations)?;
    }

    let last_ok: Option<String> = connection
        .query_row(
            "SELECT MAX(released_at) FROM observations WHERE series_id = ?1",
            [DEMO_SERIES_ID],
            |row| row.get(0),
        )
        .map_err(|error| format!("Read fixture freshness: {error}"))?;
    connection
        .execute(
            "INSERT INTO source_status (source_id, name, state, last_ok, is_demo)
             VALUES ('fixture-corn', 'Corn price fixture', 'demo', ?1, 1)
             ON CONFLICT(source_id) DO UPDATE SET last_ok = excluded.last_ok",
            [last_ok],
        )
        .map_err(|error| format!("Register fixture source: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(released_at: DateTime<Utc>, close: f64) -> Observation {
        Observation {
            series_id: SeriesId::from("price.ZC.close"),
            period: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            released_at,
            open: close - 0.1,
            high: close + 0.2,
            low: close - 0.2,
            close,
            unit: Unit::UsdPerBushel,
            source_id: SourceId::from("synthetic"),
            fetched_at: released_at,
            revision: 0,
        }
    }

    fn test_db() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        connection
    }

    #[test]
    fn observation_round_trips_through_sqlite() {
        let connection = test_db();
        let released_at = DateTime::parse_from_rfc3339("2026-10-20T20:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        upsert_observations(&connection, &[sample(released_at, 4.52)]).unwrap();

        let actual = query_series(&connection, "price.ZC.close", None, None, None).unwrap();
        assert_eq!(actual.len(), 1);
        assert_eq!(actual[0].close, 4.52);
        assert_eq!(
            actual[0].period,
            NaiveDate::from_ymd_opt(2026, 10, 20).unwrap()
        );
        assert_eq!(actual[0].released_at, released_at);
        assert_eq!(actual[0].fetched_at, released_at);
        assert_eq!(actual[0].source_id.0, "synthetic");
        assert_eq!(actual[0].unit.as_str(), "USD/bushel");
    }

    #[test]
    fn query_selects_latest_revision_available_as_of_time() {
        let connection = test_db();
        let first = DateTime::parse_from_rfc3339("2026-10-20T20:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let revised = DateTime::parse_from_rfc3339("2026-10-21T20:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        upsert_observations(&connection, &[sample(first, 4.52)]).unwrap();
        assert_eq!(
            append_observations_as_revisions(&connection, &[sample(revised, 4.61)]).unwrap(),
            1
        );

        let before_revision =
            query_series(&connection, "price.ZC.close", None, None, Some(first)).unwrap();
        let after_revision =
            query_series(&connection, "price.ZC.close", None, None, Some(revised)).unwrap();
        assert_eq!(before_revision[0].close, 4.52);
        assert_eq!(before_revision[0].revision, 0);
        assert_eq!(after_revision[0].close, 4.61);
        assert_eq!(after_revision[0].revision, 1);
    }

    #[test]
    fn workspace_json_is_saved_and_listed() {
        let connection = test_db();
        save_workspace(
            &connection,
            "default",
            "Market overview",
            r#"{"version":1,"layout":{}}"#,
        )
        .unwrap();
        let workspaces = list_workspaces(&connection).unwrap();
        assert_eq!(
            workspaces,
            vec![(
                "default".into(),
                "Market overview".into(),
                r#"{"version":1,"layout":{}}"#.into()
            )]
        );
    }

    #[test]
    fn source_registration_and_enablement_drive_due_refreshes() {
        let connection = test_db();
        register_sources(&connection).unwrap();
        let now = Utc::now();
        let due = due_sources(&connection, now).unwrap();
        assert!(due.contains(&"cftc-cot".to_string()));
        set_source_enabled(&connection, "cftc-cot", false).unwrap();
        assert!(
            !due_sources(&connection, now)
                .unwrap()
                .contains(&"cftc-cot".to_string())
        );
    }

    #[test]
    fn calendar_rules_generate_expected_weekly_and_monthly_dates() {
        let config: CalendarConfig =
            serde_json::from_str(include_str!("../../config/report-calendar.json")).unwrap();
        let now = DateTime::parse_from_rfc3339("2026-10-24T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let events = generate_calendar_events(&config, now);
        assert!(events.iter().any(|event| event.kind == "COT"
            && event.scheduled_at.date_naive().to_string() == "2026-10-30"));
        assert!(events.iter().any(|event| event.kind == "NASS"
            && event.scheduled_at.date_naive().to_string() == "2026-10-26"));
        assert!(events.iter().any(|event| event.kind == "WASDE"
            && event.scheduled_at.date_naive().to_string() == "2026-11-10"));
        assert!(
            events.iter().any(|event| event.kind == "COT"
                && event.scheduled_at.date_naive().to_string() == "2026-10-23"),
            "past releases are generated for attribution"
        );
        assert!(
            events
                .windows(2)
                .all(|pair| pair[0].scheduled_at <= pair[1].scheduled_at)
        );
    }

    #[test]
    fn one_story_can_be_stored_for_several_commodities() {
        let connection = test_db();
        let story = |commodity: &str| NewsItem {
            title: "Corn and soybean export outlook".into(),
            source: "Synthetic feed".into(),
            published_at: Utc::now(),
            url: "https://example.invalid/shared".into(),
            commodity: commodity.into(),
        };
        save_news_items(&connection, &[story("ZC"), story("ZS")]).unwrap();
        assert_eq!(list_news_items(&connection, "ZC").unwrap().len(), 1);
        assert_eq!(list_news_items(&connection, "ZS").unwrap().len(), 1);
    }

    #[test]
    fn alerts_are_saved_listed_rearmed_and_deleted() {
        let connection = test_db();
        let alert = PriceAlert {
            id: "a1".into(),
            symbol: "ZC".into(),
            direction: crate::alerts::Direction::Above,
            threshold: 4.5,
        };
        save_alert(&connection, &alert).unwrap();
        set_alert_triggered(&connection, "a1", true).unwrap();
        assert!(list_alerts(&connection).unwrap()[0].triggered);
        // Editing re-arms.
        save_alert(
            &connection,
            &PriceAlert {
                threshold: 5.0,
                ..alert
            },
        )
        .unwrap();
        let stored = list_alerts(&connection).unwrap();
        assert_eq!(
            (
                stored[0].alert.threshold,
                stored[0].triggered,
                stored[0].enabled
            ),
            (5.0, false, true)
        );
        set_alert_enabled(&connection, "a1", false).unwrap();
        assert!(!list_alerts(&connection).unwrap()[0].enabled);
        delete_alert(&connection, "a1").unwrap();
        assert!(list_alerts(&connection).unwrap().is_empty());
    }

    #[test]
    fn settings_round_trip_and_overwrite() {
        let connection = test_db();
        assert_eq!(get_setting(&connection, "explainer.pinned").unwrap(), None);
        set_setting(&connection, "explainer.pinned", "[1]").unwrap();
        set_setting(&connection, "explainer.pinned", "[1,2]").unwrap();
        assert_eq!(
            get_setting(&connection, "explainer.pinned")
                .unwrap()
                .as_deref(),
            Some("[1,2]")
        );
    }

    #[test]
    fn metric_revisions_are_all_returned_for_as_of_joins() {
        let connection = test_db();
        let at = |value: &str| {
            DateTime::parse_from_rfc3339(value)
                .unwrap()
                .with_timezone(&Utc)
        };
        let row = |released: &str, value: f64| MetricObservation {
            series_id: SeriesId::from("cot.ZC.managed_money_net"),
            period: NaiveDate::from_ymd_opt(2026, 10, 13).unwrap(),
            released_at: at(released),
            value,
            unit: "contracts".into(),
            source_id: SourceId::from("cftc-cot"),
            fetched_at: at(released),
            revision: 0,
        };
        append_metric_revisions(&connection, &[row("2026-10-16T19:30:00Z", 1.0)]).unwrap();
        append_metric_revisions(&connection, &[row("2026-10-20T12:00:00Z", 2.0)]).unwrap();
        let revisions = query_metric_revisions(&connection, "cot.ZC.managed_money_net").unwrap();
        assert_eq!(
            revisions
                .iter()
                .map(|row| (row.revision, row.value))
                .collect::<Vec<_>>(),
            vec![(0, 1.0), (1, 2.0)]
        );
        // The default query still shows only the newest revision.
        assert_eq!(
            query_metric_series(&connection, "cot.ZC.managed_money_net")
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn weather_snapshot_round_trips_with_fetch_time() {
        let connection = test_db();
        assert!(
            load_weather_snapshot(&connection, "ZC")
                .unwrap()
                .fetched_at
                .is_none()
        );
        let fetched_at = Utc::now();
        let forecast = WeatherForecast {
            region_id: "ia".into(),
            region_name: "Iowa".into(),
            latitude: 42.0,
            longitude: -93.5,
            provider: "Open-Meteo".into(),
            valid_at: fetched_at,
            temperature_c: Some(12.5),
            precipitation_mm: None,
            precipitation_probability: None,
            wind_kph: Some(9.0),
            relative_humidity: None,
            summary: "Model forecast".into(),
        };
        save_weather_snapshot(&connection, "ZC", &[forecast], fetched_at).unwrap();
        let snapshot = load_weather_snapshot(&connection, "ZC").unwrap();
        assert_eq!(snapshot.fetched_at, Some(fetched_at));
        assert_eq!(snapshot.forecasts[0].temperature_c, Some(12.5));
        assert_eq!(snapshot.forecasts[0].region_name, "Iowa");
    }

    #[test]
    fn news_headline_metadata_round_trips_and_deduplicates() {
        let connection = test_db();
        let item = NewsItem {
            title: "Synthetic corn headline".into(),
            source: "Synthetic feed".into(),
            published_at: Utc::now(),
            url: "https://example.invalid/story".into(),
            commodity: "ZC".into(),
        };
        save_news_items(&connection, &[item.clone(), item.clone()]).unwrap();
        let rows = list_news_items(&connection, "ZC").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, item.title);
        assert_eq!(rows[0].source, item.source);
        assert_eq!(rows[0].url, item.url);
    }
}
