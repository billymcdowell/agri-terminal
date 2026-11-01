//! Weekly grain barge rates and lock tonnage from USDA AgTransport, the open data behind the
//! Grain Transportation Report.
//!
//! Both datasets are replaced in full every Thursday, so rows carry no publication time of their
//! own. Backfilled weeks are dated to the GTR issue that published them (see
//! `WaterwaysConfig::gtr_issue_date`), and recent weeks to the fetch.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::Value;

use crate::core::{Cadence, DataSource, MetricObservation, SourceError, SourceRecord};
use crate::sources::fundamentals::{
    http_client, http_error, metric, parse_error, parse_flexible_date, parse_value, request_error,
    scheduled_release,
};
use crate::sources::river::{BargeLocation, HISTORY_DAYS, Lock, WaterwaysConfig};

pub const AGTRANSPORT_SOURCE: &str = "usda-agtransport";
const BARGE_RATES_URL: &str = "https://agtransport.usda.gov/resource/deqi-uken.json";
const LOCK_TONS_URL: &str = "https://agtransport.usda.gov/resource/n4pw-9ygw.json";
/// Well above six years of weekly rows for a handful of locations, locks and commodities.
const ROW_LIMIT: &str = "20000";

/// A SoQL list of quoted names, with quotes in names doubled.
fn soql_list<'a>(names: impl Iterator<Item = &'a str>) -> String {
    names
        .map(|name| format!("'{}'", name.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",")
}

fn week_ending(row: &Value) -> Option<NaiveDate> {
    row.get("date")
        .and_then(Value::as_str)
        .and_then(parse_flexible_date)
}

fn gtr_release(
    config: &WaterwaysConfig,
    week_ending: NaiveDate,
    fetched: DateTime<Utc>,
) -> DateTime<Utc> {
    scheduled_release(
        config.gtr_issue_date(week_ending),
        0,
        config.gtr_release.hour_utc,
        0,
        fetched,
    )
}

/// Barge rate rows for the configured locations, in percent of the 1976 tariff. A week with no
/// quote has an empty rate and is skipped.
pub fn parse_barge_rates(
    rows: &[Value],
    locations: &[BargeLocation],
    config: &WaterwaysConfig,
    fetched: DateTime<Utc>,
) -> Result<Vec<MetricObservation>, SourceError> {
    let mut out = Vec::new();
    for row in rows {
        let name = row
            .get("location")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(location) = locations.iter().find(|location| location.name == name) else {
            continue;
        };
        let period = week_ending(row)
            .ok_or_else(|| SourceError::Parse(format!("barge rate row has no date: {row}")))?;
        let Some(rate) = row.get("rate").and_then(parse_value) else {
            continue;
        };
        out.push(metric(
            &location.series(),
            period,
            gtr_release(config, period, fetched),
            fetched,
            rate,
            "percent_of_tariff",
            AGTRANSPORT_SOURCE,
        ));
    }
    Ok(out)
}

/// Downbound grain tons through each configured lock per week, summed over commodities.
pub fn parse_lock_tons(
    rows: &[Value],
    locks: &[Lock],
    config: &WaterwaysConfig,
    fetched: DateTime<Utc>,
) -> Result<Vec<MetricObservation>, SourceError> {
    let mut totals: BTreeMap<(String, NaiveDate), f64> = BTreeMap::new();
    for row in rows {
        let name = row.get("lock").and_then(Value::as_str).unwrap_or_default();
        let Some(lock) = locks.iter().find(|lock| lock.name == name) else {
            continue;
        };
        let period = week_ending(row)
            .ok_or_else(|| SourceError::Parse(format!("lock row has no date: {row}")))?;
        let Some(tons) = row.get("tons").and_then(parse_value) else {
            continue;
        };
        *totals.entry((lock.series(), period)).or_default() += tons;
    }
    Ok(totals
        .into_iter()
        .map(|((series, period), tons)| {
            metric(
                &series,
                period,
                gtr_release(config, period, fetched),
                fetched,
                tons,
                "short_tons",
                AGTRANSPORT_SOURCE,
            )
        })
        .collect())
}

pub struct AgTransportSource {
    pub config: WaterwaysConfig,
}

async fn fetch_rows(
    client: &reqwest::Client,
    url: &str,
    filter: String,
) -> Result<Vec<Value>, SourceError> {
    let response = client
        .get(url)
        .query(&[
            ("$where", filter),
            ("$order", "date".to_string()),
            ("$limit", ROW_LIMIT.to_string()),
        ])
        .send()
        .await
        .map_err(|error| request_error("AgTransport", error))?;
    if !response.status().is_success() {
        return Err(http_error(&response));
    }
    response.json().await.map_err(parse_error)
}

#[async_trait::async_trait]
impl DataSource for AgTransportSource {
    fn id(&self) -> &str {
        AGTRANSPORT_SOURCE
    }
    fn name(&self) -> &str {
        "USDA AgTransport barge rates and locks"
    }
    // Weekly data, but checked daily so a Thursday release is picked up the same day.
    fn cadence(&self) -> Cadence {
        Cadence::Daily
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let fetched = Utc::now();
        let since = (fetched.date_naive() - Duration::days(HISTORY_DAYS)).format("%Y-%m-%d");
        let client = http_client()?;
        let mut records = Vec::new();
        for river in &self.config.rivers {
            if !river.barge_locations.is_empty() {
                let names = soql_list(river.barge_locations.iter().map(|item| item.name.as_str()));
                let rows = fetch_rows(
                    &client,
                    BARGE_RATES_URL,
                    format!("date >= '{since}' AND location in ({names})"),
                )
                .await?;
                records.extend(parse_barge_rates(
                    &rows,
                    &river.barge_locations,
                    &self.config,
                    fetched,
                )?);
            }
            if !river.locks.is_empty() {
                let names = soql_list(river.locks.iter().map(|item| item.name.as_str()));
                let rows = fetch_rows(
                    &client,
                    LOCK_TONS_URL,
                    format!("date >= '{since}' AND lock in ({names})"),
                )
                .await?;
                records.extend(parse_lock_tons(&rows, &river.locks, &self.config, fetched)?);
            }
        }
        Ok(records.into_iter().map(SourceRecord::Metric).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::river::{BUNDLED_WATERWAYS, parse_waterways};

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn config() -> WaterwaysConfig {
        parse_waterways(BUNDLED_WATERWAYS).unwrap()
    }

    #[test]
    fn recorded_barge_rates_map_the_configured_locations_with_gtr_release() {
        let rows: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/river/agtransport_barge_rates_recorded.json"
        ))
        .unwrap();
        let config = config();
        // Fetched a week after the 20 October week was published, before the next issue.
        let fetched = at("2026-11-04T09:00:00Z");
        let parsed =
            parse_barge_rates(&rows, &config.rivers[0].barge_locations, &config, fetched).unwrap();
        assert_eq!(parsed.len(), 4);
        let find = |series: &str, period: &str| {
            parsed
                .iter()
                .find(|row| row.series_id.0 == series && row.period.to_string() == period)
                .unwrap()
        };
        let older = find("river.barge_rate.stlouis", "2026-10-20");
        assert_eq!(older.value, 592.1875);
        assert_eq!(older.released_at, at("2026-10-22T18:00:00Z"));
        assert_eq!(older.unit, "percent_of_tariff");
        let latest = find("river.barge_rate.cairo_memphis", "2026-10-27");
        assert_eq!(latest.value, 481.25);
        assert_eq!(latest.released_at, fetched);
    }

    #[test]
    fn a_rate_released_thursday_is_not_visible_on_wednesday() {
        let rows: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/river/agtransport_barge_rates_recorded.json"
        ))
        .unwrap();
        let config = config();
        let parsed = parse_barge_rates(
            &rows,
            &config.rivers[0].barge_locations,
            &config,
            at("2026-12-01T00:00:00Z"),
        )
        .unwrap();
        let stlouis: Vec<_> = parsed
            .into_iter()
            .filter(|row| row.series_id.0 == "river.barge_rate.stlouis")
            .collect();
        let wednesday =
            crate::analytics::alignment::visible_as_of(&stlouis, at("2026-10-28T23:00:00Z"))
                .unwrap();
        assert_eq!(wednesday.period.to_string(), "2026-10-20");
        let thursday =
            crate::analytics::alignment::visible_as_of(&stlouis, at("2026-10-29T18:00:00Z"))
                .unwrap();
        assert_eq!(thursday.period.to_string(), "2026-10-27");
    }

    #[test]
    fn weeks_from_a_missed_issue_are_released_with_the_next_issue() {
        let rows = vec![serde_json::json!({
            "date": "2025-10-07T00:00:00.000", "location": "St. Louis", "rate": "650"
        })];
        let config = config();
        let parsed = parse_barge_rates(
            &rows,
            &config.rivers[0].barge_locations,
            &config,
            at("2026-10-31T00:00:00Z"),
        )
        .unwrap();
        assert_eq!(parsed[0].released_at, at("2025-11-20T18:00:00Z"));
    }

    #[test]
    fn recorded_lock_rows_are_summed_over_commodities() {
        let rows: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/river/agtransport_lock_tons_recorded.json"
        ))
        .unwrap();
        let config = config();
        let fetched = at("2026-11-20T00:00:00Z");
        let parsed = parse_lock_tons(&rows, &config.rivers[0].locks, &config, fetched).unwrap();
        assert_eq!(parsed.len(), 2);
        let expected = |lock: &str| -> f64 {
            rows.iter()
                .filter(|row| row["lock"] == lock)
                .map(|row| row["tons"].as_str().unwrap().parse::<f64>().unwrap())
                .sum()
        };
        let ms27 = parsed
            .iter()
            .find(|row| row.series_id.0 == "river.locks.ms27.grain_tons")
            .unwrap();
        assert_eq!(ms27.value, expected("MS Locks 27"));
        assert_eq!(ms27.value, 454_300.0);
        assert_eq!(ms27.unit, "short_tons");
        // Week ending Saturday 24 October, published Thursday 29 October.
        assert_eq!(ms27.released_at, at("2026-10-29T18:00:00Z"));
        let olmsted = parsed
            .iter()
            .find(|row| row.series_id.0 == "river.locks.olmsted.grain_tons")
            .unwrap();
        assert_eq!(olmsted.value, expected("OH Olmsted"));
    }

    #[test]
    fn soql_names_are_quoted() {
        assert_eq!(
            soql_list(["St. Louis", "O'Brien"].into_iter()),
            "'St. Louis','O''Brien'"
        );
    }

    #[test]
    #[ignore = "live AgTransport contract check; run in nightly CI"]
    fn live_agtransport_contract() {
        let source = AgTransportSource { config: config() };
        let records = tauri::async_runtime::block_on(source.fetch()).unwrap();
        let ids: std::collections::HashSet<_> = records
            .iter()
            .filter_map(|record| match record {
                SourceRecord::Metric(row) => Some(row.series_id.0.clone()),
                SourceRecord::Price(_) => None,
            })
            .collect();
        for expected in [
            "river.barge_rate.stlouis",
            "river.barge_rate.cairo_memphis",
            "river.locks.ms27.grain_tons",
            "river.locks.olmsted.grain_tons",
        ] {
            assert!(ids.contains(expected), "missing {expected}");
        }
        assert!(records.len() > 1000, "only {} rows", records.len());
    }
}
