use std::{fs, path::Path};

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{Connection, params};

use crate::core::{Observation, SourceStatus};

const CORN_FIXTURE: &str = include_str!("../../tests/fixtures/corn_daily.csv");

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
    Ok(())
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
                    observation.series_id,
                    observation.period.to_string(),
                    observation.revision,
                    observation.released_at.to_rfc3339(),
                    observation.open,
                    observation.high,
                    observation.low,
                    observation.close,
                    observation.unit,
                    observation.source_id,
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
                    series_id: row.get(0)?,
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
                    unit: row.get(7)?,
                    source_id: row.get(8)?,
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

pub fn list_sources(connection: &Connection) -> Result<Vec<SourceStatus>, String> {
    let mut statement = connection
        .prepare("SELECT source_id, name, state, last_ok, error, is_demo FROM source_status ORDER BY name")
        .map_err(|error| format!("Prepare source query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let last_ok: Option<String> = row.get(3)?;
            Ok(SourceStatus {
                source_id: row.get(0)?,
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
            "SELECT COUNT(*) FROM observations WHERE series_id = 'price.ZC.close'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Check fixture data: {error}"))?;
    if count == 0 {
        let mut reader = csv::Reader::from_reader(CORN_FIXTURE.as_bytes());
        let mut observations = Vec::new();
        for record in reader.records() {
            let record = record.map_err(|error| format!("Read corn fixture: {error}"))?;
            let period = NaiveDate::parse_from_str(&record[0], "%Y-%m-%d")
                .map_err(|error| format!("Parse fixture date: {error}"))?;
            let open = record[1]
                .parse::<f64>()
                .map_err(|error| format!("Parse fixture open: {error}"))?;
            let high = record[2]
                .parse::<f64>()
                .map_err(|error| format!("Parse fixture high: {error}"))?;
            let low = record[3]
                .parse::<f64>()
                .map_err(|error| format!("Parse fixture low: {error}"))?;
            let close = record[4]
                .parse::<f64>()
                .map_err(|error| format!("Parse fixture close: {error}"))?;
            let released_at = period
                .and_hms_opt(20, 0, 0)
                .ok_or("Invalid fixture timestamp")?
                .and_utc();
            observations.push(Observation {
                series_id: "price.ZC.close".into(),
                period,
                released_at,
                open,
                high,
                low,
                close,
                unit: "USD/bushel".into(),
                source_id: "fixture-corn".into(),
                fetched_at: released_at,
                revision: 0,
            });
        }
        upsert_observations(connection, &observations)?;
    }

    let last_ok: Option<String> = connection
        .query_row(
            "SELECT MAX(released_at) FROM observations WHERE series_id = 'price.ZC.close'",
            [],
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
