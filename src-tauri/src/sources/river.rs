//! River gauges: the waterways configuration and the Memphis stage source.
//!
//! USGS publishes no stage at Memphis, so `nwps-river-stage` reads recent hourly readings from the
//! National Water Prediction Service (about 30 days) and fills older history from the Iowa
//! Environmental Mesonet archive of the same NWS observations. Each day keeps one reading, the one
//! nearest 14:00 UTC (08:00 CST), the time the Corps' own daily Memphis series uses.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::{Cadence, DataSource, MetricObservation, SourceError, SourceRecord};
use crate::sources::fundamentals::{
    http_error, metric, parse_error, request_error, scheduled_release,
};

pub const BUNDLED_WATERWAYS: &str = include_str!("../../../config/waterways.json");
pub const NWPS_STAGE_SOURCE: &str = "nwps-river-stage";
pub const USGS_STAGE_SOURCE: &str = "usgs-river-stage";
/// Rows backfilled from the archive keep their own lineage.
pub const IEM_ARCHIVE_SOURCE: &str = "iem-hml";

const NWPS_BASE: &str = "https://api.water.noaa.gov/nwps/v1";
const IEM_HML_URL: &str = "https://mesonet.agron.iastate.edu/cgi-bin/request/hml.py";
const USER_AGENT: &str = "AgriTerminal/0.1 (open-source agricultural market research app)";
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Six years, so a five-year seasonal range has five earlier years to draw on.
pub const HISTORY_DAYS: i64 = 2200;
/// The archive answers about 92 days of hourly readings in ten seconds, well inside the timeout.
const ARCHIVE_CHUNK_DAYS: i64 = 92;
/// A cap on archive requests per refresh, so a failing or empty archive is not hammered.
const MAX_ARCHIVE_REQUESTS: usize = 30;
const DAILY_READING_HOUR_UTC: u32 = 14;
const DAILY_READING_WINDOW_MINUTES: i64 = 60;
/// NWPS marks missing values with -999 or -9999; no gauge reads that low.
const MISSING_VALUE_BELOW: f64 = -900.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WaterwaysConfig {
    pub version: u32,
    #[serde(default)]
    pub notes: String,
    pub bands: Bands,
    pub gtr_release: GtrRelease,
    pub rivers: Vec<River>,
}

/// When the weekly Grain Transportation Report data become public: the Thursday after the week
/// they describe, unless that week's issue was missed (federal funding lapses), in which case the
/// data came out with the next issue.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GtrRelease {
    pub hour_utc: u32,
    pub missed_issues: Vec<MissedIssues>,
}

/// Scheduled issue dates from `from` to `to` that were not published; their data came out on
/// `next_issue`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MissedIssues {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub next_issue: NaiveDate,
}

/// Score cut-offs: below `elevated` is NORMAL, below `high` is ELEVATED, the rest HIGH.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Bands {
    pub elevated: f64,
    pub high: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct River {
    pub id: String,
    pub name: String,
    pub weights: Weights,
    /// How many days of forecast the FCST component looks at.
    pub forecast_days: i64,
    /// AgTransport barge rate locations, named as in the dataset.
    pub barge_locations: Vec<BargeLocation>,
    /// AgTransport locks, named as in the dataset.
    pub locks: Vec<Lock>,
    pub gauges: Vec<Gauge>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BargeLocation {
    pub id: String,
    pub name: String,
    /// The 1976 tariff benchmark: a quote of 100 percent is this many cents per short ton.
    pub benchmark_cents_per_ton: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Lock {
    pub id: String,
    pub name: String,
}

impl BargeLocation {
    pub fn series(&self) -> String {
        format!("river.barge_rate.{}", self.id)
    }
}

impl Lock {
    pub fn series(&self) -> String {
        format!("river.locks.{}.grain_tons", self.id)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Weights {
    pub depth: f64,
    pub forecast: f64,
    pub traffic: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Gauge {
    pub id: String,
    pub name: String,
    pub usgs_site: Option<String>,
    pub nws_id: String,
    /// The source that writes this gauge's stage series.
    pub stage_source: String,
    pub unit: String,
    pub thresholds: Thresholds,
    /// True until Phase 7 calibration replaces the starting values.
    pub provisional: bool,
    /// The barge rate location whose freight reacts to this gauge.
    pub barge_location: Option<String>,
    /// Locks whose combined grain tonnage passes this gauge, for the traffic component.
    #[serde(default)]
    pub locks: Vec<String>,
}

/// Stage levels on the gauge's own datum: deficit is 0 at `normal` and 1 at `critical`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Thresholds {
    pub normal: f64,
    pub restriction: f64,
    pub critical: f64,
}

impl Gauge {
    pub fn stage_series(&self) -> String {
        format!("river.{}.stage", self.id)
    }

    /// The lowest forecast stage for each target day, one revision per forecast issue.
    pub fn forecast_series(&self) -> String {
        format!("river.{}.forecast_min", self.id)
    }
}

impl WaterwaysConfig {
    pub fn gauges(&self) -> impl Iterator<Item = (&River, &Gauge)> {
        self.rivers
            .iter()
            .flat_map(|river| river.gauges.iter().map(move |gauge| (river, gauge)))
    }

    /// The day GTR data for a week become public: the Thursday after the week ends, or the next
    /// published issue when that Thursday's issue was missed.
    pub fn gtr_issue_date(&self, week_ending: NaiveDate) -> NaiveDate {
        let days = (3 - i64::from(week_ending.weekday().num_days_from_monday())).rem_euclid(7);
        let scheduled = week_ending + Duration::days(if days == 0 { 7 } else { days });
        self.gtr_release
            .missed_issues
            .iter()
            .find(|missed| (missed.from..=missed.to).contains(&scheduled))
            .map_or(scheduled, |missed| missed.next_issue)
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Parses and checks a waterways file, listing every problem with the field to change.
pub fn parse_waterways(text: &str) -> Result<WaterwaysConfig, String> {
    let config: WaterwaysConfig =
        serde_json::from_str(text).map_err(|error| format!("waterways: {error}"))?;
    let mut problems = Vec::new();
    if config.version != 1 {
        problems.push(format!("version: {} is not supported", config.version));
    }
    if !(0.0 < config.bands.elevated
        && config.bands.elevated < config.bands.high
        && config.bands.high <= 100.0)
    {
        problems.push("bands: need 0 < elevated < high <= 100".into());
    }
    if config.gtr_release.hour_utc > 23 {
        problems.push("gtr_release.hour_utc: must be 0 to 23".into());
    }
    for missed in &config.gtr_release.missed_issues {
        if !(missed.from <= missed.to && missed.to < missed.next_issue) {
            problems.push(format!(
                "gtr_release.missed_issues: need from <= to < next_issue (from {})",
                missed.from
            ));
        }
    }
    let mut gauge_ids = BTreeSet::new();
    for river in &config.rivers {
        if !valid_id(&river.id) {
            problems.push(format!(
                "rivers.id: \"{}\" must be lowercase letters, digits or '_'",
                river.id
            ));
        }
        let weights = river.weights;
        let sum = weights.depth + weights.forecast + weights.traffic;
        if [weights.depth, weights.forecast, weights.traffic]
            .iter()
            .any(|weight| *weight < 0.0)
            || (sum - 1.0).abs() > 1e-6
        {
            problems.push(format!(
                "rivers.{}.weights: must be zero or more and add up to 1 (they add up to {sum})",
                river.id
            ));
        }
        if !(1..=14).contains(&river.forecast_days) {
            problems.push(format!(
                "rivers.{}.forecast_days: must be between 1 and 14",
                river.id
            ));
        }
        let mut location_ids = BTreeSet::new();
        for location in &river.barge_locations {
            if !valid_id(&location.id) || !location_ids.insert(location.id.as_str()) {
                problems.push(format!(
                    "rivers.{}.barge_locations.{}: id must be unique lowercase letters, digits or '_'",
                    river.id, location.id
                ));
            }
            if location.benchmark_cents_per_ton <= 0.0 {
                problems.push(format!(
                    "rivers.{}.barge_locations.{}.benchmark_cents_per_ton: must be above 0",
                    river.id, location.id
                ));
            }
        }
        let mut lock_ids = BTreeSet::new();
        for lock in &river.locks {
            if !valid_id(&lock.id) || !lock_ids.insert(lock.id.as_str()) {
                problems.push(format!(
                    "rivers.{}.locks.{}: id must be unique lowercase letters, digits or '_'",
                    river.id, lock.id
                ));
            }
        }
        for gauge in &river.gauges {
            let field = format!("rivers.{}.gauges.{}", river.id, gauge.id);
            if let Some(location) = &gauge.barge_location
                && !location_ids.contains(location.as_str())
            {
                problems.push(format!(
                    "{field}.barge_location: \"{location}\" is not one of this river's barge_locations"
                ));
            }
            for lock in &gauge.locks {
                if !lock_ids.contains(lock.as_str()) {
                    problems.push(format!(
                        "{field}.locks: \"{lock}\" is not one of this river's locks"
                    ));
                }
            }
            if !valid_id(&gauge.id) || !gauge_ids.insert(gauge.id.clone()) {
                problems.push(format!(
                    "{field}.id: must be unique lowercase letters, digits or '_'"
                ));
            }
            let thresholds = gauge.thresholds;
            if !(thresholds.normal > thresholds.restriction
                && thresholds.restriction > thresholds.critical)
            {
                problems.push(format!(
                    "{field}.thresholds: need normal > restriction > critical"
                ));
            }
            if ![USGS_STAGE_SOURCE, NWPS_STAGE_SOURCE].contains(&gauge.stage_source.as_str()) {
                problems.push(format!(
                    "{field}.stage_source: must be {USGS_STAGE_SOURCE} or {NWPS_STAGE_SOURCE}"
                ));
            }
            if gauge.stage_source == USGS_STAGE_SOURCE && gauge.usgs_site.is_none() {
                problems.push(format!("{field}.usgs_site: needed for {USGS_STAGE_SOURCE}"));
            }
            if gauge.usgs_site.as_ref().is_some_and(|site| {
                !(8..=15).contains(&site.len()) || !site.chars().all(|c| c.is_ascii_digit())
            }) {
                problems.push(format!(
                    "{field}.usgs_site: must be an 8 to 15 digit USGS site number"
                ));
            }
            if gauge.nws_id.len() != 5 || !gauge.nws_id.chars().all(|c| c.is_ascii_alphanumeric()) {
                problems.push(format!(
                    "{field}.nws_id: \"{}\" must be a five-character NWS location id",
                    gauge.nws_id
                ));
            }
            if gauge.unit != "ft" {
                problems.push(format!("{field}.unit: only ft is supported"));
            }
        }
    }
    if problems.is_empty() {
        Ok(config)
    } else {
        Err(problems.join("\n"))
    }
}

/// The bundled waterways file, or `waterways.json` in the app data directory when present, so
/// thresholds and weights can be tuned without a new build.
pub fn load_waterways(data_directory: &Path) -> Result<WaterwaysConfig, String> {
    let path = data_directory.join("waterways.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_waterways(&text).map_err(|error| format!("{}: {error}", path.display())),
        Err(_) => parse_waterways(BUNDLED_WATERWAYS),
    }
}

/// One stage reading in feet.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reading {
    pub at: DateTime<Utc>,
    pub value: f64,
}

/// An NWPS `observed` or `forecast` product: `{ primaryUnits, data: [{ validTime, primary }] }`.
pub(crate) fn parse_nwps_product(product: &Value) -> Result<Vec<Reading>, SourceError> {
    let units = product
        .get("primaryUnits")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if units != "ft" {
        return Err(SourceError::Parse(format!(
            "NWPS stage is in \"{units}\", expected ft"
        )));
    }
    let data = product
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| SourceError::Parse("NWPS product has no data list".into()))?;
    let mut readings = Vec::new();
    for point in data {
        let time = point
            .get("validTime")
            .and_then(Value::as_str)
            .ok_or_else(|| SourceError::Parse("NWPS point has no validTime".into()))?;
        let at = DateTime::parse_from_rfc3339(time)
            .map_err(|error| SourceError::Parse(format!("NWPS validTime \"{time}\": {error}")))?
            .with_timezone(&Utc);
        if let Some(value) = point
            .get("primary")
            .and_then(Value::as_f64)
            .filter(|value| *value > MISSING_VALUE_BELOW)
        {
            readings.push(Reading { at, value });
        }
    }
    Ok(readings)
}

/// An IEM HML observation CSV. Its columns vary with what the gauge reported (`Flow[kcfs]` comes
/// and goes), so the stage column is found by name. An empty result has a different header and no
/// rows, which is not an error.
pub(crate) fn parse_iem_observations(body: &[u8]) -> Result<Vec<Reading>, SourceError> {
    let mut reader = csv::Reader::from_reader(body);
    let headers = reader
        .headers()
        .map_err(|error| SourceError::Parse(format!("IEM header: {error}")))?
        .clone();
    let time_column = headers.iter().position(|name| name == "valid[UTC]");
    let stage_column = headers.iter().position(|name| name == "Stage[ft]");
    let mut readings = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| SourceError::Parse(format!("IEM row: {error}")))?;
        let (Some(time_column), Some(stage_column)) = (time_column, stage_column) else {
            return Err(SourceError::Parse(format!(
                "IEM rows have no valid[UTC] and Stage[ft] columns (found {})",
                headers.iter().collect::<Vec<_>>().join(", ")
            )));
        };
        let time = record.get(time_column).unwrap_or_default();
        let at = NaiveDateTime::parse_from_str(time, "%Y-%m-%d %H:%M")
            .map_err(|error| SourceError::Parse(format!("IEM time \"{time}\": {error}")))?
            .and_utc();
        if let Some(value) = record
            .get(stage_column)
            .and_then(|text| text.trim().parse::<f64>().ok())
            .filter(|value| *value > MISSING_VALUE_BELOW)
        {
            readings.push(Reading { at, value });
        }
    }
    Ok(readings)
}

/// One value per UTC day: the reading nearest 14:00 UTC, if one falls within an hour of it. A day
/// whose 14:00 reading has not arrived yet is left out rather than filled from another hour, so it
/// does not come back later as a spurious revision.
pub fn daily_readings(readings: &[Reading]) -> BTreeMap<NaiveDate, f64> {
    let mut best: BTreeMap<NaiveDate, (i64, f64)> = BTreeMap::new();
    for reading in readings {
        let date = reading.at.date_naive();
        let target = date
            .and_hms_opt(DAILY_READING_HOUR_UTC, 0, 0)
            .expect("a fixed hour is always valid")
            .and_utc();
        let distance = (reading.at - target).num_minutes().abs();
        if distance > DAILY_READING_WINDOW_MINUTES {
            continue;
        }
        let entry = best.entry(date).or_insert((distance, reading.value));
        if distance < entry.0 {
            *entry = (distance, reading.value);
        }
    }
    best.into_iter()
        .map(|(date, (_, value))| (date, value))
        .collect()
}

/// Inclusive date ranges between `start` and `end` that have no stored value, newest first and cut
/// into archive-sized pieces. Working from the stored dates, not just the first and last, means a
/// piece that failed is simply asked for again next time.
pub fn missing_windows(
    stored: &BTreeSet<NaiveDate>,
    start: NaiveDate,
    end: NaiveDate,
) -> Vec<(NaiveDate, NaiveDate)> {
    let mut runs = Vec::new();
    let mut run_start: Option<NaiveDate> = None;
    let mut day = start;
    while day <= end {
        match (stored.contains(&day), run_start) {
            (false, None) => run_start = Some(day),
            (true, Some(first)) => {
                runs.push((first, day - Duration::days(1)));
                run_start = None;
            }
            _ => {}
        }
        day += Duration::days(1);
    }
    if let Some(first) = run_start {
        runs.push((first, end));
    }
    let mut windows = Vec::new();
    for (first, last) in runs.into_iter().rev() {
        let mut piece_end = last;
        while piece_end >= first {
            let piece_start = (piece_end - Duration::days(ARCHIVE_CHUNK_DAYS - 1)).max(first);
            windows.push((piece_start, piece_end));
            piece_end = piece_start - Duration::days(1);
        }
    }
    windows
}

pub(crate) fn client() -> Result<reqwest::Client, SourceError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| SourceError::Unavailable(error.to_string()))
}

async fn fetch_nwps_json(
    client: &reqwest::Client,
    nws_id: &str,
    product: &str,
) -> Result<Value, SourceError> {
    let response = client
        .get(format!("{NWPS_BASE}/gauges/{nws_id}/stageflow/{product}"))
        .send()
        .await
        .map_err(|error| request_error("NWPS", error))?;
    if !response.status().is_success() {
        return Err(http_error(&response));
    }
    response.json().await.map_err(parse_error)
}

async fn fetch_iem_csv(
    client: &reqwest::Client,
    nws_id: &str,
    kind: &str,
    first: NaiveDate,
    last: NaiveDate,
) -> Result<Vec<u8>, SourceError> {
    let response = client
        .get(IEM_HML_URL)
        .query(&[
            ("station", nws_id.to_string()),
            ("sts", format!("{first}T00:00Z")),
            ("ets", format!("{}T00:00Z", last + Duration::days(1))),
            ("kind", kind.to_string()),
            ("fmt", "csv".to_string()),
            ("tz", "UTC".to_string()),
        ])
        .send()
        .await
        .map_err(|error| request_error("IEM", error))?;
    if !response.status().is_success() {
        return Err(http_error(&response));
    }
    Ok(response.bytes().await.map_err(parse_error)?.to_vec())
}

async fn fetch_iem_observations(
    client: &reqwest::Client,
    nws_id: &str,
    first: NaiveDate,
    last: NaiveDate,
) -> Result<Vec<Reading>, SourceError> {
    parse_iem_observations(&fetch_iem_csv(client, nws_id, "obs", first, last).await?)
}

/// Forecast issues from `first` to `last`. The archive answers forecasts one UTC year at a time.
async fn fetch_iem_forecasts(
    client: &reqwest::Client,
    nws_id: &str,
    first: NaiveDate,
    last: NaiveDate,
) -> Result<Vec<ForecastIssue>, SourceError> {
    let mut issues = Vec::new();
    let mut start = first;
    while start <= last {
        let year_end = NaiveDate::from_ymd_opt(start.year(), 12, 31).expect("31 December exists");
        let end = year_end.min(last);
        let body = fetch_iem_csv(client, nws_id, "forecasts", start, end).await?;
        issues.extend(parse_iem_forecasts(&body)?);
        start = end + Duration::days(1);
    }
    Ok(issues)
}

pub struct NwpsGauge {
    pub series_id: String,
    pub nws_id: String,
    /// Periods already stored for the series, so the archive is only asked for what is missing.
    pub stored: BTreeSet<NaiveDate>,
}

pub struct NwpsStageSource {
    pub gauges: Vec<NwpsGauge>,
}

impl NwpsStageSource {
    pub fn from_config(
        config: &WaterwaysConfig,
        stored: impl Fn(&str) -> BTreeSet<NaiveDate>,
    ) -> Self {
        Self {
            gauges: config
                .gauges()
                .filter(|(_, gauge)| gauge.stage_source == NWPS_STAGE_SOURCE)
                .map(|(_, gauge)| NwpsGauge {
                    series_id: gauge.stage_series(),
                    nws_id: gauge.nws_id.clone(),
                    stored: stored(&gauge.stage_series()),
                })
                .collect(),
        }
    }
}

/// Daily stage rows from live and archive readings. Live readings win a day both cover.
pub fn stage_records(
    series_id: &str,
    live: &[Reading],
    archive: &[Reading],
    fetched: DateTime<Utc>,
) -> Vec<MetricObservation> {
    let mut days: BTreeMap<NaiveDate, (f64, &str)> = daily_readings(archive)
        .into_iter()
        .map(|(date, value)| (date, (value, IEM_ARCHIVE_SOURCE)))
        .collect();
    for (date, value) in daily_readings(live) {
        days.insert(date, (value, NWPS_STAGE_SOURCE));
    }
    days.into_iter()
        .map(|(date, (value, source))| {
            metric(
                series_id,
                date,
                // The 14:00 UTC reading is published within the hour.
                scheduled_release(date, 0, 15, 0, fetched),
                fetched,
                value,
                "ft",
                source,
            )
        })
        .collect()
}

#[async_trait::async_trait]
impl DataSource for NwpsStageSource {
    fn id(&self) -> &str {
        NWPS_STAGE_SOURCE
    }
    fn name(&self) -> &str {
        "NWS river stage"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Daily
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let fetched = Utc::now();
        let today = fetched.date_naive();
        let client = client()?;
        let mut records = Vec::new();
        for gauge in &self.gauges {
            let live =
                parse_nwps_product(&fetch_nwps_json(&client, &gauge.nws_id, "observed").await?)?;
            let live_start = live
                .iter()
                .map(|reading| reading.at.date_naive())
                .min()
                .unwrap_or(today - Duration::days(28));
            let mut archive = Vec::new();
            let windows = missing_windows(
                &gauge.stored,
                today - Duration::days(HISTORY_DAYS),
                live_start,
            );
            for (first, last) in windows.into_iter().take(MAX_ARCHIVE_REQUESTS) {
                match fetch_iem_observations(&client, &gauge.nws_id, first, last).await {
                    Ok(readings) => archive.extend(readings),
                    Err(error) => {
                        // Live data is still stored; the missing history is asked for next time.
                        tracing::warn!(gauge = %gauge.nws_id, %first, %last, %error, "River stage archive request failed");
                        break;
                    }
                }
            }
            records.extend(stage_records(&gauge.series_id, &live, &archive, fetched));
        }
        Ok(records.into_iter().map(SourceRecord::Metric).collect())
    }
}

pub const NWPS_FORECAST_SOURCE: &str = "nwps-river-forecast";
/// Forecasts reach about 14 days ahead, so a target day's history needs the issues from the 15
/// days before it.
const FORECAST_LEAD_DAYS: i64 = 15;

/// One forecast issue: when NWS published it and the stage it expected.
#[derive(Clone, Debug, PartialEq)]
pub struct ForecastIssue {
    pub issued: DateTime<Utc>,
    pub readings: Vec<Reading>,
}

pub(crate) fn parse_nwps_forecast(product: &Value) -> Result<ForecastIssue, SourceError> {
    let time = product
        .get("issuedTime")
        .and_then(Value::as_str)
        .ok_or_else(|| SourceError::Parse("NWPS forecast has no issuedTime".into()))?;
    let issued = DateTime::parse_from_rfc3339(time)
        .map_err(|error| SourceError::Parse(format!("NWPS issuedTime \"{time}\": {error}")))?
        .with_timezone(&Utc);
    Ok(ForecastIssue {
        issued,
        readings: parse_nwps_product(product)?,
    })
}

/// An IEM HML forecast CSV: one row per issue and forecast time.
pub(crate) fn parse_iem_forecasts(body: &[u8]) -> Result<Vec<ForecastIssue>, SourceError> {
    let mut reader = csv::Reader::from_reader(body);
    let headers = reader
        .headers()
        .map_err(|error| SourceError::Parse(format!("IEM header: {error}")))?
        .clone();
    let column = |name: &str| headers.iter().position(|header| header == name);
    let columns = (
        column("issued[UTC]"),
        column("forecast_valid[UTC]"),
        column("primary_value"),
        column("primaryunits"),
    );
    let mut issues: BTreeMap<DateTime<Utc>, Vec<Reading>> = BTreeMap::new();
    for record in reader.records() {
        let record = record.map_err(|error| SourceError::Parse(format!("IEM row: {error}")))?;
        let (Some(issued), Some(valid), Some(value), Some(units)) = columns else {
            return Err(SourceError::Parse(format!(
                "IEM forecast rows are missing expected columns (found {})",
                headers.iter().collect::<Vec<_>>().join(", ")
            )));
        };
        if record.get(units) != Some("ft") {
            return Err(SourceError::Parse(format!(
                "IEM forecast is in \"{}\", expected ft",
                record.get(units).unwrap_or_default()
            )));
        }
        let time = |index: usize| {
            let text = record.get(index).unwrap_or_default();
            NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M")
                .map(|time| time.and_utc())
                .map_err(|error| SourceError::Parse(format!("IEM time \"{text}\": {error}")))
        };
        let issued_at = time(issued)?;
        let entry = issues.entry(issued_at).or_default();
        if let Some(stage) = record
            .get(value)
            .and_then(|text| text.trim().parse::<f64>().ok())
            .filter(|stage| *stage > MISSING_VALUE_BELOW)
        {
            entry.push(Reading {
                at: time(valid)?,
                value: stage,
            });
        }
    }
    Ok(issues
        .into_iter()
        .map(|(issued, readings)| ForecastIssue { issued, readings })
        .collect())
}

/// Each issue's lowest expected stage for every target day from the issue's own day on, released
/// when the issue was published. Issues are taken oldest first, so a target day's revisions are
/// stored in the order NWS published them.
pub fn forecast_records(
    series_id: &str,
    issues: &[ForecastIssue],
    keep: impl Fn(NaiveDate) -> bool,
    source: &str,
    fetched: DateTime<Utc>,
) -> Vec<MetricObservation> {
    let mut ordered: Vec<&ForecastIssue> = issues.iter().collect();
    ordered.sort_by_key(|issue| issue.issued);
    let mut records = Vec::new();
    for issue in ordered {
        let mut lows: BTreeMap<NaiveDate, f64> = BTreeMap::new();
        for reading in &issue.readings {
            let target = reading.at.date_naive();
            if target < issue.issued.date_naive() || !keep(target) {
                continue;
            }
            let low = lows.entry(target).or_insert(reading.value);
            *low = low.min(reading.value);
        }
        records.extend(lows.into_iter().map(|(target, low)| {
            metric(series_id, target, issue.issued, fetched, low, "ft", source)
        }));
    }
    records
}

pub struct ForecastGauge {
    pub series_id: String,
    pub nws_id: String,
    /// Target days already stored, so the archive is only asked for what is missing.
    pub stored: BTreeSet<NaiveDate>,
}

/// The latest NWS forecast for every configured gauge, with forecast history from the IEM
/// archive for target days before the first live issue.
pub struct NwpsForecastSource {
    pub gauges: Vec<ForecastGauge>,
}

impl NwpsForecastSource {
    pub fn from_config(
        config: &WaterwaysConfig,
        stored: impl Fn(&str) -> BTreeSet<NaiveDate>,
    ) -> Self {
        Self {
            gauges: config
                .gauges()
                .map(|(_, gauge)| ForecastGauge {
                    series_id: gauge.forecast_series(),
                    nws_id: gauge.nws_id.clone(),
                    stored: stored(&gauge.forecast_series()),
                })
                .collect(),
        }
    }
}

#[async_trait::async_trait]
impl DataSource for NwpsForecastSource {
    fn id(&self) -> &str {
        NWPS_FORECAST_SOURCE
    }
    fn name(&self) -> &str {
        "NWS river forecasts"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Daily
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let fetched = Utc::now();
        let today = fetched.date_naive();
        let client = client()?;
        let mut records = Vec::new();
        for gauge in &self.gauges {
            let live =
                parse_nwps_forecast(&fetch_nwps_json(&client, &gauge.nws_id, "forecast").await?)?;
            let first_live_target = live.issued.date_naive();
            let windows = missing_windows(
                &gauge.stored,
                today - Duration::days(HISTORY_DAYS),
                first_live_target - Duration::days(1),
            );
            for (first, last) in windows.into_iter().take(MAX_ARCHIVE_REQUESTS) {
                match fetch_iem_forecasts(
                    &client,
                    &gauge.nws_id,
                    first - Duration::days(FORECAST_LEAD_DAYS),
                    last,
                )
                .await
                {
                    Ok(issues) => records.extend(forecast_records(
                        &gauge.series_id,
                        &issues,
                        |target| (first..=last).contains(&target),
                        IEM_ARCHIVE_SOURCE,
                        fetched,
                    )),
                    Err(error) => {
                        tracing::warn!(gauge = %gauge.nws_id, %first, %last, %error, "River forecast archive request failed");
                        break;
                    }
                }
            }
            records.extend(forecast_records(
                &gauge.series_id,
                &[live],
                |_| true,
                NWPS_FORECAST_SOURCE,
                fetched,
            ));
        }
        Ok(records.into_iter().map(SourceRecord::Metric).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn the_bundled_waterways_file_is_valid() {
        let config = parse_waterways(BUNDLED_WATERWAYS).unwrap();
        let (river, stlouis) = config
            .gauges()
            .find(|(_, gauge)| gauge.id == "stlouis")
            .unwrap();
        assert_eq!(river.id, "miss");
        assert_eq!(stlouis.stage_series(), "river.stlouis.stage");
        assert_eq!(stlouis.stage_source, USGS_STAGE_SOURCE);
        let (_, memphis) = config
            .gauges()
            .find(|(_, gauge)| gauge.id == "memphis")
            .unwrap();
        assert_eq!(memphis.stage_source, NWPS_STAGE_SOURCE);
        assert_eq!(memphis.nws_id, "MEMT1");
    }

    #[test]
    fn invalid_waterways_files_name_the_field_to_change() {
        let broken = BUNDLED_WATERWAYS
            .replace("\"depth\": 0.5", "\"depth\": 0.6")
            .replace("\"critical\": -3.5", "\"critical\": 2.0")
            .replace("\"MEMT1\"", "\"MEM\"");
        let error = parse_waterways(&broken).unwrap_err();
        assert!(error.contains("rivers.miss.weights"), "{error}");
        assert!(error.contains("gauges.stlouis.thresholds"), "{error}");
        assert!(error.contains("gauges.memphis.nws_id"), "{error}");
        assert!(parse_waterways("{\"version\": 1}").is_err());
    }

    #[test]
    fn gauges_link_to_barge_locations_and_locks_that_exist() {
        let broken = BUNDLED_WATERWAYS
            .replace(
                "\"barge_location\": \"stlouis\"",
                "\"barge_location\": \"chicago\"",
            )
            .replace("\"locks\": [\"ms27\"]", "\"locks\": [\"ms99\"]")
            .replace(
                "\"benchmark_cents_per_ton\": 314",
                "\"benchmark_cents_per_ton\": 0",
            );
        let error = parse_waterways(&broken).unwrap_err();
        assert!(error.contains("gauges.stlouis.barge_location"), "{error}");
        assert!(error.contains("gauges.stlouis.locks"), "{error}");
        assert!(
            error.contains("cairo_memphis.benchmark_cents_per_ton"),
            "{error}"
        );
        let config = parse_waterways(BUNDLED_WATERWAYS).unwrap();
        let river = &config.rivers[0];
        assert_eq!(
            river.barge_locations[0].series(),
            "river.barge_rate.stlouis"
        );
        assert_eq!(river.locks[1].series(), "river.locks.olmsted.grain_tons");
    }

    #[test]
    fn gtr_data_are_public_the_thursday_after_their_week_or_with_the_next_issue() {
        let config = parse_waterways(BUNDLED_WATERWAYS).unwrap();
        // Barge rates: week ending Tuesday. Locks: week ending Saturday. Basis: week ending Friday.
        assert_eq!(
            config.gtr_issue_date(date("2026-10-27")),
            date("2026-10-29")
        );
        assert_eq!(
            config.gtr_issue_date(date("2026-10-24")),
            date("2026-10-29")
        );
        assert_eq!(
            config.gtr_issue_date(date("2026-10-23")),
            date("2026-10-29")
        );
        // A week ending on Thursday is published the next Thursday.
        assert_eq!(
            config.gtr_issue_date(date("2026-10-29")),
            date("2026-11-05")
        );
        // No issues from 2 October to 13 November 2025: the data came out on 20 November.
        assert_eq!(
            config.gtr_issue_date(date("2025-10-07")),
            date("2025-11-20")
        );
        assert_eq!(
            config.gtr_issue_date(date("2025-11-08")),
            date("2025-11-20")
        );
        assert_eq!(
            config.gtr_issue_date(date("2025-11-15")),
            date("2025-11-20")
        );
    }

    #[test]
    fn an_override_in_the_data_directory_replaces_the_bundled_file() {
        let directory = std::env::temp_dir().join(format!("agri-waterways-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        assert_eq!(load_waterways(&directory).unwrap().bands.elevated, 40.0);
        std::fs::write(
            directory.join("waterways.json"),
            BUNDLED_WATERWAYS.replace("\"elevated\": 40", "\"elevated\": 35"),
        )
        .unwrap();
        assert_eq!(load_waterways(&directory).unwrap().bands.elevated, 35.0);
        std::fs::write(directory.join("waterways.json"), "{").unwrap();
        assert!(
            load_waterways(&directory)
                .unwrap_err()
                .contains("waterways.json")
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn nwps_recorded_observations_parse_in_feet() {
        let recorded: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/river/nwps_stageflow_memt1_recorded.json"
        ))
        .unwrap();
        let readings = parse_nwps_product(&recorded["observed"]).unwrap();
        assert_eq!(readings.len(), 8);
        assert_eq!(readings.last().unwrap().at, at("2026-10-31T20:00:00Z"));
        assert_eq!(readings.last().unwrap().value, -4.25);
        let forecast = parse_nwps_product(&recorded["forecast"]).unwrap();
        assert_eq!(forecast.len(), 57);
        let mut metres = recorded["observed"].clone();
        metres["primaryUnits"] = Value::from("m");
        assert!(parse_nwps_product(&metres).is_err());
    }

    #[test]
    fn missing_nwps_values_are_skipped() {
        let product: Value = serde_json::from_str(
            r#"{"primaryUnits":"ft","data":[{"validTime":"2026-10-31T14:00:00Z","primary":-999},{"validTime":"2026-10-31T15:00:00Z","primary":-4.2}]}"#,
        )
        .unwrap();
        assert_eq!(
            parse_nwps_product(&product).unwrap(),
            vec![Reading {
                at: at("2026-10-31T15:00:00Z"),
                value: -4.2
            }]
        );
    }

    #[test]
    fn iem_recorded_observations_parse_and_reduce_to_the_14_utc_reading() {
        let readings = parse_iem_observations(include_bytes!(
            "../../../tests/fixtures/river/iem_hml_obs_memt1_2022_recorded.csv"
        ))
        .unwrap();
        assert_eq!(readings.len(), 24);
        let daily = daily_readings(&readings);
        let at_14 = readings
            .iter()
            .find(|reading| reading.at == at("2022-10-21T14:00:00Z"))
            .unwrap();
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[&date("2022-10-21")], at_14.value);
    }

    #[test]
    fn iem_columns_are_found_by_name_and_an_empty_result_is_not_an_error() {
        let body = b"station,valid[UTC],Flow[kcfs],Stage[ft]\nMEMT1,2023-12-15 14:00,,-5.65\nMEMT1,2023-12-15 15:00,412.0,\n";
        let readings = parse_iem_observations(body).unwrap();
        assert_eq!(
            readings,
            vec![Reading {
                at: at("2023-12-15T14:00:00Z"),
                value: -5.65
            }]
        );
        assert!(
            parse_iem_observations(b"station,valid,label,value\n")
                .unwrap()
                .is_empty()
        );
        assert!(parse_iem_observations(b"station,when,height\nMEMT1,x,1\n").is_err());
    }

    #[test]
    fn a_day_without_a_reading_near_14_utc_is_left_out() {
        let readings = [
            Reading {
                at: at("2026-10-30T13:30:00Z"),
                value: 1.0,
            },
            Reading {
                at: at("2026-10-30T14:10:00Z"),
                value: 2.0,
            },
            Reading {
                at: at("2026-10-31T09:00:00Z"),
                value: 3.0,
            },
        ];
        let daily = daily_readings(&readings);
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[&date("2026-10-30")], 2.0);
    }

    #[test]
    fn missing_windows_cover_only_gaps_newest_first_in_archive_sized_pieces() {
        let start = date("2026-01-01");
        let end = date("2026-12-31");
        let stored: BTreeSet<NaiveDate> = (0..10)
            .map(|offset| date("2026-06-01") + Duration::days(offset))
            .collect();
        let windows = missing_windows(&stored, start, end);
        assert_eq!(windows[0].1, end);
        assert!(
            windows
                .iter()
                .all(|(first, last)| first <= last
                    && (*last - *first).num_days() < ARCHIVE_CHUNK_DAYS)
        );
        let covered: usize = windows
            .iter()
            .map(|(first, last)| (*last - *first).num_days() as usize + 1)
            .sum();
        assert_eq!(covered, 365 - 10);
        assert!(
            windows
                .iter()
                .all(|(first, last)| { !stored.iter().any(|day| (*first..=*last).contains(day)) })
        );
        let everything: BTreeSet<NaiveDate> = start.iter_days().take(365).collect();
        assert!(missing_windows(&everything, start, end).is_empty());
    }

    #[test]
    fn stage_records_prefer_live_readings_and_keep_lineage() {
        let fetched = at("2026-10-31T21:00:00Z");
        let archive = [
            Reading {
                at: at("2026-09-01T14:00:00Z"),
                value: -1.0,
            },
            Reading {
                at: at("2026-10-30T14:00:00Z"),
                value: -3.0,
            },
        ];
        let live = [Reading {
            at: at("2026-10-30T14:00:00Z"),
            value: -3.5,
        }];
        let rows = stage_records("river.memphis.stage", &live, &archive, fetched);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].source_id.0, IEM_ARCHIVE_SOURCE);
        assert_eq!(rows[0].released_at, at("2026-09-01T15:00:00Z"));
        assert_eq!(rows[1].source_id.0, NWPS_STAGE_SOURCE);
        assert_eq!(rows[1].value, -3.5);
        // Recent rows are dated to the fetch, which is never earlier than publication.
        assert_eq!(rows[1].released_at, fetched);
        assert!(rows.iter().all(|row| row.unit == "ft"));
    }

    #[test]
    fn nwps_recorded_forecast_becomes_daily_lows_released_at_the_issue_time() {
        let recorded: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/river/nwps_stageflow_eadm7_recorded.json"
        ))
        .unwrap();
        let issue = parse_nwps_forecast(&recorded["forecast"]).unwrap();
        assert_eq!(issue.issued, at("2026-10-31T16:03:00Z"));
        let fetched = at("2026-10-31T21:00:00Z");
        let rows = forecast_records(
            "river.stlouis.forecast_min",
            std::slice::from_ref(&issue),
            |_| true,
            NWPS_FORECAST_SOURCE,
            fetched,
        );
        assert_eq!(rows.first().unwrap().period, date("2026-10-31"));
        assert_eq!(rows.last().unwrap().period, date("2026-11-14"));
        assert!(rows.iter().all(|row| row.released_at == issue.issued
            && row.fetched_at == fetched
            && row.unit == "ft"));
        // The 14 November value is the lowest six-hourly point forecast for that day.
        let low = issue
            .readings
            .iter()
            .filter(|reading| reading.at.date_naive() == date("2026-11-14"))
            .map(|reading| reading.value)
            .fold(f64::INFINITY, f64::min);
        assert_eq!(rows.last().unwrap().value, low);
    }

    #[test]
    fn iem_recorded_forecast_parses_as_one_issue() {
        let issues = parse_iem_forecasts(include_bytes!(
            "../../../tests/fixtures/river/iem_hml_forecasts_eadm7_2022_recorded.csv"
        ))
        .unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].issued, at("2022-10-01T15:53:00Z"));
        assert_eq!(issues[0].readings.len(), 56);
        assert!(
            parse_iem_forecasts(b"station,valid,label,value\n")
                .unwrap()
                .is_empty()
        );
        assert!(
            parse_iem_forecasts(
                b"station,issued[UTC],primaryname,primaryunits,secondaryname,secondaryunits,forecast_valid[UTC],primary_value,secondary_value\nEADM7,2022-10-01 15:53,Stage,m,Flow,kcfs,2022-10-01 18:00,-0.3,\n"
            )
            .is_err()
        );
    }

    #[test]
    fn successive_forecast_issues_are_stored_in_order_and_seen_only_once_issued() {
        let issue = |issued: &str, value: f64| ForecastIssue {
            issued: at(issued),
            readings: vec![Reading {
                at: at("2022-10-10T12:00:00Z"),
                value,
            }],
        };
        let fetched = at("2026-10-31T21:00:00Z");
        // Archive issues arrive newest first; they are stored oldest first.
        let rows = forecast_records(
            "river.stlouis.forecast_min",
            &[
                issue("2022-10-02T15:00:00Z", -2.0),
                issue("2022-10-01T15:00:00Z", -1.0),
            ],
            |_| true,
            IEM_ARCHIVE_SOURCE,
            fetched,
        );
        let connection = crate::store::test_connection();
        crate::store::append_source_records(
            &connection,
            &rows
                .into_iter()
                .map(SourceRecord::Metric)
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let revisions =
            crate::store::query_metric_revisions(&connection, "river.stlouis.forecast_min")
                .unwrap();
        assert_eq!(revisions.len(), 2);
        // Each issue keeps its own publication time, although both were fetched today.
        assert_eq!(revisions[1].released_at, at("2022-10-02T15:00:00Z"));
        let visible = |when: &str| {
            crate::analytics::alignment::visible_as_of(&revisions, at(when)).map(|row| row.value)
        };
        assert_eq!(visible("2022-09-30T00:00:00Z"), None);
        assert_eq!(visible("2022-10-01T20:00:00Z"), Some(-1.0));
        assert_eq!(visible("2022-10-03T00:00:00Z"), Some(-2.0));
    }

    /// Fills a database with every river series, as a first launch would. Set `AGRI_RIVER_DB` to
    /// keep the database for analysis; otherwise it is written to the temp directory and removed.
    #[test]
    #[ignore = "live six-year backfill of every river source into a database; takes several minutes"]
    fn live_backfill_fills_every_river_series_for_the_raw_panel() {
        let keep = std::env::var_os("AGRI_RIVER_DB").map(std::path::PathBuf::from);
        let path = keep.clone().unwrap_or_else(|| {
            std::env::temp_dir().join(format!("agri-river-{}.sqlite3", std::process::id()))
        });
        let _ = std::fs::remove_file(&path);
        let connection = crate::store::open(&path).unwrap();
        let config = parse_waterways(BUNDLED_WATERWAYS).unwrap();
        let usgs = crate::plugins::registry::find_source(
            &std::env::temp_dir().join("none"),
            USGS_STAGE_SOURCE,
        )
        .unwrap();
        let stage = NwpsStageSource::from_config(&config, |_| BTreeSet::new());
        let forecasts = NwpsForecastSource::from_config(&config, |_| BTreeSet::new());
        let barges = crate::sources::agtransport::AgTransportSource {
            config: config.clone(),
        };
        for source in [
            usgs.as_ref(),
            &stage as &dyn DataSource,
            &forecasts,
            &barges,
        ] {
            let records = tauri::async_runtime::block_on(source.fetch()).unwrap();
            crate::store::append_source_records(&connection, &records).unwrap();
        }
        // A second refresh finds nothing missing and asks the archive for nothing.
        let today = Utc::now().date_naive();
        for (series, end) in [
            ("river.memphis.stage", today - Duration::days(28)),
            ("river.stlouis.forecast_min", today - Duration::days(1)),
        ] {
            let periods: BTreeSet<NaiveDate> = crate::store::metric_periods(&connection, series)
                .unwrap()
                .into_iter()
                .collect();
            let remaining = missing_windows(&periods, today - Duration::days(HISTORY_DAYS), end);
            assert!(
                remaining
                    .iter()
                    .all(|(first, last)| (*last - *first).num_days() < 7),
                "{series}: {remaining:?}"
            );
        }
        let listed = crate::store::list_stored_series(&connection).unwrap();
        let rows = |series: &str| -> i64 {
            listed
                .iter()
                .filter(|item| item.series_id.0 == series)
                .map(|item| item.rows)
                .sum()
        };
        for series in [
            "river.stlouis.stage",
            "river.memphis.stage",
            "river.stlouis.forecast_min",
            "river.memphis.forecast_min",
        ] {
            assert!(rows(series) > 2000, "{series} has {} rows", rows(series));
        }
        for series in [
            "river.barge_rate.stlouis",
            "river.barge_rate.cairo_memphis",
            "river.locks.ms27.grain_tons",
            "river.locks.olmsted.grain_tons",
        ] {
            assert!(rows(series) > 250, "{series} has {} rows", rows(series));
        }
        // Every stored river row was public no later than the app saw it.
        for item in listed
            .iter()
            .filter(|item| item.series_id.0.starts_with("river."))
        {
            let crate::core::StoredRows::Metric(stored) =
                crate::store::query_stored_rows(&connection, &item.series_id.0).unwrap()
            else {
                panic!("{} is not a metric", item.series_id.0);
            };
            assert!(stored.iter().all(|row| row.released_at <= row.fetched_at));
        }
        if keep.is_none() {
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    #[ignore = "live NWPS and IEM forecast contract check; run in nightly CI"]
    fn live_forecast_contract() {
        let today = Utc::now().date_naive();
        let source = NwpsForecastSource {
            gauges: vec![ForecastGauge {
                series_id: "river.stlouis.forecast_min".into(),
                nws_id: "EADM7".into(),
                // Only the five target days before today are missing from the archive.
                stored: (today - Duration::days(HISTORY_DAYS))
                    .iter_days()
                    .take((HISTORY_DAYS - 5) as usize)
                    .collect(),
            }],
        };
        let records = tauri::async_runtime::block_on(source.fetch()).unwrap();
        let rows: Vec<_> = records
            .iter()
            .filter_map(|record| match record {
                SourceRecord::Metric(row) => Some(row),
                SourceRecord::Price(_) => None,
            })
            .collect();
        assert!(
            rows.iter()
                .any(|row| row.source_id.0 == NWPS_FORECAST_SOURCE && row.period > today)
        );
        let archive: Vec<_> = rows
            .iter()
            .filter(|row| row.source_id.0 == IEM_ARCHIVE_SOURCE)
            .collect();
        assert!(!archive.is_empty());
        assert!(
            archive
                .iter()
                .all(|row| row.period < today && row.released_at < row.fetched_at)
        );
    }

    #[test]
    #[ignore = "live NWPS and IEM contract check; run in nightly CI"]
    fn live_nwps_and_iem_contract() {
        let source = NwpsStageSource {
            gauges: vec![NwpsGauge {
                series_id: "river.memphis.stage".into(),
                nws_id: "MEMT1".into(),
                // Everything but the last ten days of archive history is "stored", so the
                // contract makes one small archive request.
                stored: (Utc::now().date_naive() - Duration::days(HISTORY_DAYS))
                    .iter_days()
                    .take((HISTORY_DAYS - 40) as usize)
                    .collect(),
            }],
        };
        let records = tauri::async_runtime::block_on(source.fetch()).unwrap();
        let rows: Vec<_> = records
            .iter()
            .filter_map(|record| match record {
                SourceRecord::Metric(row) => Some(row),
                SourceRecord::Price(_) => None,
            })
            .collect();
        assert!(rows.iter().any(|row| row.source_id.0 == NWPS_STAGE_SOURCE));
        assert!(rows.iter().any(|row| row.source_id.0 == IEM_ARCHIVE_SOURCE));
    }
}
