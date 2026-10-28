use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::core::{
    Cadence, DataSource, MetricObservation, SeriesId, SourceError, SourceId, SourceRecord,
};

const CFTC_URL: &str = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";
const NASS_URL: &str = "https://quickstats.nass.usda.gov/api/api_GET/";
const FAS_URL: &str = "https://api.fas.usda.gov/api/";

/// CFTC contract-market codes: CBOT corn, CBOT soybeans and CBOT SRW wheat (the ZW contract).
/// Matching on names would also pull HRW and spring wheat into the same series.
const CFTC_CONTRACTS: [(&str, &str); 3] = [
    ("CORN", "002602"),
    ("SOYBEANS", "005602"),
    ("WHEAT", "001602"),
];

pub struct CftcSource;
pub struct NassSource;
pub struct FasSource;

pub fn has_secret(id: &str) -> bool {
    keyring::Entry::new("com.williammcdowell.agri-terminal", id)
        .and_then(|entry| entry.get_password())
        .is_ok()
}

#[async_trait::async_trait]
impl DataSource for CftcSource {
    fn id(&self) -> &str {
        "cftc-cot"
    }
    fn name(&self) -> &str {
        "CFTC Commitments of Traders"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Weekly
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let client = http_client()?;
        let mut all = Vec::new();
        for (commodity, contract_code) in CFTC_CONTRACTS {
            let response = client
                .get(CFTC_URL)
                .query(&[
                    (
                        "$where",
                        format!("cftc_contract_market_code='{contract_code}'"),
                    ),
                    ("$order", "report_date_as_yyyy_mm_dd DESC".into()),
                    ("$limit", "1000".into()),
                ])
                .send()
                .await
                .map_err(|error| request_error("CFTC", error))?;
            if !response.status().is_success() {
                return Err(http_error(&response));
            }
            let rows: Vec<CftcRow> = response.json().await.map_err(parse_error)?;
            all.extend(parse_cftc_rows(&rows, commodity, Utc::now())?);
        }
        Ok(all.into_iter().map(SourceRecord::Metric).collect())
    }
}

#[async_trait::async_trait]
impl DataSource for NassSource {
    fn id(&self) -> &str {
        "usda-nass"
    }
    fn name(&self) -> &str {
        "USDA NASS QuickStats"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Weekly
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let key = secret("usda-nass")?;
        let client = http_client()?;
        let mut all = Vec::new();
        for (commodity, symbol) in [("CORN", "zc"), ("SOYBEANS", "zs"), ("WHEAT", "zw")] {
            for (category, series_suffix) in [("PROGRESS", "progress"), ("CONDITION", "condition")]
            {
                let response = client
                    .get(NASS_URL)
                    .query(&[
                        ("key", key.as_str()),
                        ("commodity_desc", commodity),
                        ("statisticcat_desc", category),
                        ("agg_level_desc", "NATIONAL"),
                        ("year__GE", "2015"),
                        ("freq_desc", "WEEKLY"),
                        ("format", "JSON"),
                    ])
                    .send()
                    .await
                    .map_err(|error| request_error("NASS", error))?;
                if !response.status().is_success() {
                    return Err(http_error(&response));
                }
                let rows: NassResponse = response.json().await.map_err(parse_error)?;
                all.extend(parse_nass_rows(
                    &rows.data,
                    symbol,
                    series_suffix,
                    Utc::now(),
                )?);
            }
        }
        Ok(all.into_iter().map(SourceRecord::Metric).collect())
    }
}

#[async_trait::async_trait]
impl DataSource for FasSource {
    fn id(&self) -> &str {
        "usda-fas"
    }
    fn name(&self) -> &str {
        "USDA FAS OpenData"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Weekly
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let key = secret("usda-fas")?;
        let client = http_client()?;
        let mut all = Vec::new();
        // PSD and Export Sales number commodities separately; ESR rejects PSD codes with HTTP 400.
        // ESR wheat is all classes (107) so it lines up with the PSD wheat balance sheet.
        let today = Utc::now().date_naive();
        let current_year = today.year();
        let attribute_names = fetch_psd_attribute_names(&client, &key).await?;
        for (commodity, psd_code, esr_code, season_start_month) in [
            ("CORN", "0440000", 401, 9),
            ("SOYBEANS", "2222000", 801, 9),
            ("WHEAT", "0011000", 107, 6),
        ] {
            for year in current_year - 5..=current_year {
                let url = format!("{FAS_URL}psd/commodity/{psd_code}/country/US/year/{year}");
                let response = client
                    .get(url)
                    .header("X-Api-Key", &key)
                    .send()
                    .await
                    .map_err(|error| request_error("FAS", error))?;
                if !response.status().is_success() {
                    return Err(http_error(&response));
                }
                let rows: Vec<Value> = response.json().await.map_err(parse_error)?;
                all.extend(parse_fas_psd(
                    &rows,
                    commodity,
                    Utc::now(),
                    &attribute_names,
                )?);
            }
            let market_year = esr_market_year(today, season_start_month);
            let url = format!(
                "{FAS_URL}esr/exports/commodityCode/{esr_code}/allCountries/marketYear/{market_year}"
            );
            let response = client
                .get(url)
                .header("X-Api-Key", &key)
                .send()
                .await
                .map_err(|error| request_error("FAS export sales", error))?;
            if !response.status().is_success() {
                return Err(http_error(&response));
            }
            let rows: Vec<Value> = response.json().await.map_err(parse_error)?;
            all.extend(parse_fas_esr(&rows, commodity, Utc::now())?);
        }
        Ok(all.into_iter().map(SourceRecord::Metric).collect())
    }
}

/// Export Sales names a marketing year by the calendar year it ends in: on 2026-10-25 the corn
/// season that began 2026-09-01 is market year 2027.
fn esr_market_year(today: NaiveDate, season_start_month: u32) -> i32 {
    if today.month() >= season_start_month {
        today.year() + 1
    } else {
        today.year()
    }
}

/// PSD rows reference attributes by id; the lookup endpoint supplies the labels.
async fn fetch_psd_attribute_names(
    client: &reqwest::Client,
    key: &str,
) -> Result<HashMap<i64, String>, SourceError> {
    let response = client
        .get(format!("{FAS_URL}psd/commodityAttributes"))
        .header("X-Api-Key", key)
        .send()
        .await
        .map_err(|error| request_error("FAS attribute lookup", error))?;
    if !response.status().is_success() {
        return Err(http_error(&response));
    }
    let rows: Vec<Value> = response.json().await.map_err(parse_error)?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get("attributeId")?.as_i64()?,
                row.get("attributeName")?.as_str()?.to_string(),
            ))
        })
        .collect())
}

#[derive(Deserialize)]
struct CftcRow {
    report_date_as_yyyy_mm_dd: String,
    #[serde(default, rename = "m_money_positions_long_all")]
    managed_money_positions_long_all: Option<String>,
    #[serde(default, rename = "m_money_positions_short_all")]
    managed_money_positions_short_all: Option<String>,
    #[serde(default)]
    prod_merc_positions_long: Option<String>,
    #[serde(default)]
    prod_merc_positions_short: Option<String>,
    #[serde(default)]
    swap_positions_long_all: Option<String>,
    #[serde(default, rename = "swap__positions_short_all")]
    swap_positions_short_all: Option<String>,
}

#[derive(Deserialize)]
struct NassResponse {
    #[serde(default)]
    data: Vec<BTreeMap<String, Value>>,
}

fn parse_cftc_rows(
    rows: &[CftcRow],
    commodity: &str,
    fetched: DateTime<Utc>,
) -> Result<Vec<MetricObservation>, SourceError> {
    let mut out = Vec::new();
    for row in rows {
        // Socrata returns floating timestamps such as "2026-10-20T00:00:00.000".
        let period = parse_flexible_date(&row.report_date_as_yyyy_mm_dd).ok_or_else(|| {
            SourceError::Parse(format!(
                "Unrecognized CFTC report date: {}",
                row.report_date_as_yyyy_mm_dd
            ))
        })?;
        // Positions are as of Tuesday and published the following Friday at 15:30 ET.
        let released_at = scheduled_release(period, 3, 19, 30, fetched);
        let symbol = commodity_symbol(commodity);
        for (suffix, long, short) in [
            (
                "managed_money_net",
                row.managed_money_positions_long_all.as_deref(),
                row.managed_money_positions_short_all.as_deref(),
            ),
            (
                "commercial_net",
                row.prod_merc_positions_long.as_deref(),
                row.prod_merc_positions_short.as_deref(),
            ),
            (
                "swap_net",
                row.swap_positions_long_all.as_deref(),
                row.swap_positions_short_all.as_deref(),
            ),
        ] {
            if let (Some(long), Some(short)) =
                (long.and_then(parse_number), short.and_then(parse_number))
            {
                out.push(metric(
                    &format!("cot.{symbol}.{suffix}"),
                    period,
                    released_at,
                    fetched,
                    long - short,
                    "contracts",
                    "cftc-cot",
                ));
            }
        }
    }
    Ok(out)
}

fn parse_nass_rows(
    rows: &[BTreeMap<String, Value>],
    symbol: &str,
    suffix: &str,
    fetched: DateTime<Utc>,
) -> Result<Vec<MetricObservation>, SourceError> {
    let text = |row: &BTreeMap<String, Value>, key: &str| {
        row.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase()
    };
    let mut values: BTreeMap<(NaiveDate, String), f64> = BTreeMap::new();
    for row in rows {
        let Some(period) = row
            .get("week_ending")
            .and_then(Value::as_str)
            .and_then(parse_flexible_date)
        else {
            continue;
        };
        let Some(value) = row.get("Value").and_then(parse_value) else {
            continue;
        };
        let short_desc = text(row, "short_desc");
        let class = text(row, "class_desc");
        // Silage progress shares the CORN commodity code and would double count grain rows.
        if short_desc.contains("silage") || text(row, "util_practice_desc").contains("silage") {
            continue;
        }
        // Chicago wheat (ZW) is winter wheat; spring and durum are separate classes.
        if symbol == "zw" && !(class.starts_with("winter") || short_desc.contains("winter")) {
            continue;
        }
        let unit = text(row, "unit_desc");
        let label = unit
            .strip_prefix("pct ")
            .map(str::to_string)
            .or_else(|| {
                short_desc
                    .rsplit("measured in pct ")
                    .next()
                    .filter(|tail| *tail != short_desc)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| suffix.to_string())
            .trim()
            .replace(' ', "_");
        let group = match (suffix, label.as_str()) {
            ("condition", "good" | "excellent") => "good_excellent".to_string(),
            ("condition", "poor" | "very_poor") => "poor_very_poor".to_string(),
            _ => label,
        };
        *values
            .entry((period, format!("nass.{symbol}.{suffix}.{group}")))
            .or_default() += value;
    }
    Ok(values
        .into_iter()
        .map(|((period, series), value)| {
            // Crop Progress is released Monday 4 p.m. ET for the week ending Sunday.
            let released_at = scheduled_release(period, 1, 20, 0, fetched);
            metric(
                &series,
                period,
                released_at,
                fetched,
                value,
                "percent",
                "usda-nass",
            )
        })
        .collect())
}

/// `attribute_names` maps PSD attribute ids to labels; rows that carry their own name use it.
fn parse_fas_psd(
    rows: &[Value],
    commodity: &str,
    fetched: DateTime<Utc>,
    attribute_names: &HashMap<i64, String>,
) -> Result<Vec<MetricObservation>, SourceError> {
    let mut latest: BTreeMap<(NaiveDate, &'static str), f64> = BTreeMap::new();
    for row in rows {
        let Some(date) = first_string(row, &["marketYear", "marketingYear", "year", "market_year"])
        else {
            continue;
        };
        let Some(period) = parse_year_date(&date) else {
            continue;
        };
        let attributes = row
            .get("attributes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_else(|| vec![row.clone()]);
        for attribute in attributes {
            let name = first_string(&attribute, &["attributeName", "attribute", "name"])
                .or_else(|| {
                    attribute
                        .get("attributeId")
                        .and_then(Value::as_i64)
                        .and_then(|id| attribute_names.get(&id).cloned())
                })
                .unwrap_or_default();
            let value = attribute.get("value").and_then(parse_value);
            if let (Some(value), Some(suffix)) = (value, normalize_psd_name(&name)) {
                latest.insert((period, suffix), value);
            }
        }
    }
    let symbol = commodity_symbol(commodity).to_lowercase();
    Ok(latest
        .into_iter()
        .map(|((period, suffix), value)| {
            metric(
                &format!("fas.{symbol}.{suffix}"),
                period,
                fetched,
                fetched,
                value,
                "1000 metric tons",
                "usda-fas",
            )
        })
        .collect())
}

/// Export-sales rows can arrive per destination country, so values for a week are summed.
fn parse_fas_esr(
    rows: &[Value],
    commodity: &str,
    fetched: DateTime<Utc>,
) -> Result<Vec<MetricObservation>, SourceError> {
    let mut totals: BTreeMap<(NaiveDate, &'static str), f64> = BTreeMap::new();
    for row in rows {
        let date = first_string(
            row,
            &[
                "weekEndingDate",
                "weekEnding",
                "week_ending",
                "reportDate",
                "report_date",
            ],
        );
        let Some(period) = date.as_deref().and_then(parse_flexible_date) else {
            continue;
        };
        for (metric_name, aliases) in [
            (
                "sales",
                &[
                    "currentMYNetSales",
                    "netSales",
                    "weeklyExports",
                    "sales",
                    "currentWeekExports",
                ][..],
            ),
            (
                "outstanding_sales",
                &["outstandingSales", "outstanding_sales"][..],
            ),
            (
                "accumulated_exports",
                &["accumulatedExports", "accumulated_exports"][..],
            ),
        ] {
            if let Some(value) = first_number(row, aliases) {
                *totals.entry((period, metric_name)).or_default() += value;
            }
        }
    }
    let symbol = commodity_symbol(commodity).to_lowercase();
    Ok(totals
        .into_iter()
        .map(|((period, metric_name), value)| {
            // Export sales publish Thursday 8:30 ET for the week ending the previous Thursday.
            let released_at = scheduled_release(period, 7, 12, 30, fetched);
            metric(
                &format!("fas.esr.{symbol}.{metric_name}"),
                period,
                released_at,
                fetched,
                value,
                "metric tons",
                "usda-fas",
            )
        })
        .collect())
}

pub(crate) fn parse_flexible_date(value: &str) -> Option<NaiveDate> {
    value
        .get(..10)
        .and_then(|prefix| NaiveDate::parse_from_str(prefix, "%Y-%m-%d").ok())
        .or_else(|| NaiveDate::parse_from_str(value, "%m/%d/%Y").ok())
}

/// Weekly agency reports publish on a fixed schedule after their reference period. For backfilled
/// history the first time the app saw a row says nothing about when it became public, so rows
/// older than a week use the scheduled release; recent rows keep the later, real fetch time.
pub(crate) fn scheduled_release(
    period: NaiveDate,
    days_after: i64,
    hour_utc: u32,
    minute_utc: u32,
    fetched: DateTime<Utc>,
) -> DateTime<Utc> {
    let scheduled = (period + chrono::Duration::days(days_after))
        .and_hms_opt(hour_utc, minute_utc, 0)
        .map_or(fetched, |time| time.and_utc());
    if fetched - scheduled > chrono::Duration::days(7) {
        scheduled
    } else {
        fetched
    }
}

pub(crate) fn metric(
    series: &str,
    period: NaiveDate,
    released_at: DateTime<Utc>,
    fetched: DateTime<Utc>,
    value: f64,
    unit: &str,
    source: &str,
) -> MetricObservation {
    MetricObservation {
        series_id: SeriesId::from(series),
        period,
        released_at,
        value,
        unit: unit.into(),
        source_id: SourceId::from(source),
        fetched_at: fetched,
        revision: 0,
    }
}
fn parse_number(value: &str) -> Option<f64> {
    value.replace(',', "").parse().ok()
}
pub(crate) fn parse_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(parse_number))
}
fn first_number(value: &Value, names: &[&str]) -> Option<f64> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(parse_value))
}
fn first_string(value: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| match value.get(*name)? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}
fn commodity_symbol(name: &str) -> &str {
    match name {
        "CORN" => "ZC",
        "SOYBEANS" => "ZS",
        "WHEAT" => "ZW",
        other => other,
    }
}
fn parse_year_date(year: &str) -> Option<NaiveDate> {
    let year = year.get(0..4)?.parse::<i32>().ok()?;
    NaiveDate::from_ymd_opt(year, 9, 1)
}
fn normalize_psd_name(name: &str) -> Option<&'static str> {
    let value = name.to_ascii_lowercase();
    if value.contains("beginning stocks") {
        Some("beginning_stocks")
    } else if value.contains("production") {
        Some("production")
    } else if value.contains("imports") {
        Some("imports")
    } else if value.contains("domestic consumption") {
        Some("domestic_consumption")
    } else if value.contains("exports") {
        Some("exports")
    } else if value.contains("ending stocks") {
        Some("ending_stocks")
    } else {
        None
    }
}
pub(crate) fn secret(service: &str) -> Result<String, SourceError> {
    keyring::Entry::new("com.williammcdowell.agri-terminal", service)
        .map_err(|error| SourceError::Unavailable(error.to_string()))?
        .get_password()
        .map_err(|error| {
            if matches!(error, keyring::Error::NoEntry) {
                SourceError::Auth
            } else {
                SourceError::Unavailable(error.to_string())
            }
        })
}
pub(crate) fn http_error(response: &reqwest::Response) -> SourceError {
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .parse::<i64>()
                .map(|seconds| Utc::now() + chrono::Duration::seconds(seconds))
                .ok()
                .or_else(|| {
                    DateTime::parse_from_rfc3339(value)
                        .ok()
                        .map(|time| time.with_timezone(&Utc))
                })
        });
    match status {
        401 | 403 => SourceError::Auth,
        429 => SourceError::RateLimited { retry_after },
        other => SourceError::Transient(format!("Provider returned HTTP {other}")),
    }
}

/// Limits for each provider call. The scheduler refreshes sources one after another, so a request
/// that never finishes would otherwise hold up every later refresh.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

pub(crate) fn http_client() -> Result<reqwest::Client, SourceError> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| SourceError::Unavailable(describe(error)))
}

/// A request that got no HTTP response at all.
pub(crate) fn request_error(provider: &str, error: reqwest::Error) -> SourceError {
    let reason = if error.is_timeout() {
        format!("no response within {} seconds", REQUEST_TIMEOUT.as_secs())
    } else if error.is_connect() {
        "could not connect; check the internet connection".to_string()
    } else {
        describe(error)
    };
    SourceError::Transient(format!("{provider} request failed: {reason}"))
}

/// A response body that could not be read or decoded.
pub(crate) fn parse_error(error: reqwest::Error) -> SourceError {
    if error.is_timeout() {
        return SourceError::Transient(format!(
            "response did not finish within {} seconds",
            REQUEST_TIMEOUT.as_secs()
        ));
    }
    SourceError::Parse(describe(error))
}

/// The error and its causes without the request URL. NASS takes its key as a query parameter, and
/// these messages are stored as source status, shown in the app and written to the log.
fn describe(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut text = error.to_string();
    let mut cause = std::error::Error::source(&error);
    while let Some(inner) = cause {
        text.push_str(": ");
        text.push_str(&inner.to_string());
        cause = inner.source();
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn request_errors_never_include_a_key_from_the_url() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 2048];
            let _ = socket.read(&mut buffer).await;
            let body = "not json";
            let _ = socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await;
        });
        let client = http_client().unwrap();
        let url = format!("http://127.0.0.1:{port}/api?key=SECRET-KEY");
        let response = client.get(&url).send().await.unwrap();
        let decode = parse_error(response.json::<Value>().await.unwrap_err());
        assert!(matches!(decode, SourceError::Parse(_)));
        assert!(!decode.to_string().contains("SECRET-KEY"), "{decode}");

        // Nothing listens on the port any more, so the connection is refused.
        let refused = request_error("NASS", client.get(&url).send().await.unwrap_err());
        assert!(!refused.to_string().contains("SECRET-KEY"), "{refused}");
        assert!(
            refused.to_string().contains("NASS request failed"),
            "{refused}"
        );
    }

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn live_metrics(records: &[SourceRecord]) -> Vec<&MetricObservation> {
        records
            .iter()
            .filter_map(|record| match record {
                SourceRecord::Metric(row) => Some(row),
                SourceRecord::Price(_) => None,
            })
            .collect()
    }

    /// A series with two rows for one period would be stored as spurious revisions.
    fn assert_unique_periods(rows: &[&MetricObservation]) {
        let mut seen = std::collections::HashSet::new();
        for row in rows {
            assert!(
                seen.insert((row.series_id.0.clone(), row.period)),
                "duplicate {} {}",
                row.series_id.0,
                row.period
            );
        }
    }

    #[test]
    fn cftc_recorded_response_maps_net_positions_and_schedules_release() {
        let rows: Vec<CftcRow> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/cftc_disaggregated_recorded.json"
        ))
        .unwrap();
        let fetched = at("2026-10-24T12:00:00Z");
        let parsed = parse_cftc_rows(&rows, "CORN", fetched).unwrap();
        assert_eq!(parsed.len(), 6);
        assert_eq!(parsed[0].series_id.0, "cot.ZC.managed_money_net");
        assert_eq!(parsed[0].period.to_string(), "2026-10-20");
        assert_eq!(parsed[0].value, 297_797.0 - 133_374.0);
        assert_eq!(parsed[1].series_id.0, "cot.ZC.commercial_net");
        assert_eq!(parsed[1].value, 415_001.0 - 943_745.0);
        // The newest report is recent, so its release is the real fetch time; the older
        // report is backfill and takes the scheduled Friday 19:30 UTC release.
        assert_eq!(parsed[0].released_at, fetched);
        assert_eq!(parsed[3].released_at, at("2026-10-16T19:30:00Z"));
        assert!(parsed.iter().all(|row| row.released_at <= row.fetched_at));
    }

    #[test]
    fn nass_condition_rows_exclude_silage_and_other_wheat_classes() {
        let fixture: NassResponse = serde_json::from_str(include_str!(
            "../../../tests/fixtures/phase3_nass_synthetic.json"
        ))
        .unwrap();
        let fetched = at("2026-10-24T12:00:00Z");
        // The connector queries one commodity at a time, so mirror that split here.
        let (corn_rows, wheat_rows): (Vec<_>, Vec<_>) = fixture.data.into_iter().partition(|row| {
            row["short_desc"]
                .as_str()
                .is_some_and(|text| text.starts_with("CORN"))
        });
        let corn = parse_nass_rows(&corn_rows, "zc", "condition", fetched).unwrap();
        let series: Vec<_> = corn
            .iter()
            .map(|row| (row.series_id.0.as_str(), row.value))
            .collect();
        assert_eq!(
            series,
            vec![
                ("nass.zc.condition.fair", 31.0),
                ("nass.zc.condition.good_excellent", 66.0),
                ("nass.zc.condition.poor_very_poor", 18.0),
            ]
        );
        let wheat = parse_nass_rows(&wheat_rows, "zw", "condition", fetched).unwrap();
        assert_eq!(wheat.len(), 1);
        assert_eq!(wheat[0].value, 71.0);
        let progress_rows: Vec<_> = corn_rows
            .iter()
            .filter(|row| row["statisticcat_desc"] == "PROGRESS")
            .cloned()
            .collect();
        assert_eq!(progress_rows.len(), 1);
        let progress = parse_nass_rows(&progress_rows, "zc", "progress", fetched).unwrap();
        assert!(progress.is_empty(), "silage progress must not be counted");
    }

    #[test]
    fn fas_psd_rows_resolve_attribute_ids_and_numeric_market_years() {
        let rows: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/phase3_fas_synthetic.json"
        ))
        .unwrap();
        let names = HashMap::from([(20, "Beginning Stocks".to_string())]);
        let parsed = parse_fas_psd(&rows, "CORN", Utc::now(), &names).unwrap();
        let series: Vec<_> = parsed
            .iter()
            .map(|row| (row.series_id.0.as_str(), row.value))
            .collect();
        assert!(series.contains(&("fas.zc.beginning_stocks", 12_000.0)));
        assert!(series.contains(&("fas.zc.production", 390_000.0)));
        assert!(series.contains(&("fas.zc.ending_stocks", 51_000.0)));
        assert!(series.contains(&("fas.zc.beginning_stocks", 13_000.0)));
    }

    #[test]
    fn fas_export_sales_are_summed_across_countries() {
        let rows: Vec<Value> = serde_json::from_str(
            r#"[{"weekEndingDate":"2026-10-15T00:00:00","currentMYNetSales":100,"outstandingSales":5},
                {"weekEndingDate":"2026-10-15T00:00:00","currentMYNetSales":50,"outstandingSales":7}]"#,
        )
        .unwrap();
        let parsed = parse_fas_esr(&rows, "CORN", at("2026-10-24T12:00:00Z")).unwrap();
        let value = |name: &str| {
            parsed
                .iter()
                .find(|row| row.series_id.0 == name)
                .unwrap()
                .value
        };
        assert_eq!(value("fas.esr.zc.sales"), 150.0);
        assert_eq!(value("fas.esr.zc.outstanding_sales"), 12.0);
    }

    #[test]
    fn export_sales_market_year_is_the_year_the_season_ends() {
        let day = |y, m, d| NaiveDate::from_ymd_opt(y, m, d).unwrap();
        // Corn and soybeans start September 1, wheat June 1.
        assert_eq!(esr_market_year(day(2026, 8, 31), 9), 2026);
        assert_eq!(esr_market_year(day(2026, 9, 1), 9), 2027);
        assert_eq!(esr_market_year(day(2026, 10, 25), 9), 2027);
        assert_eq!(esr_market_year(day(2026, 5, 31), 6), 2026);
        assert_eq!(esr_market_year(day(2026, 6, 1), 6), 2027);
    }

    #[test]
    fn scheduled_release_never_claims_a_release_after_the_fetch() {
        let fetched = at("2026-10-24T12:00:00Z");
        let period = NaiveDate::from_ymd_opt(2026, 10, 23).unwrap();
        assert_eq!(scheduled_release(period, 3, 19, 30, fetched), fetched);
    }

    #[test]
    #[ignore = "live CFTC contract check; run in nightly CI"]
    fn live_cftc_contract() {
        let records = tauri::async_runtime::block_on(CftcSource.fetch()).unwrap();
        let metrics = live_metrics(&records);
        for series in [
            "cot.ZC.managed_money_net",
            "cot.ZS.commercial_net",
            "cot.ZW.swap_net",
        ] {
            assert!(
                metrics.iter().any(|row| row.series_id.0 == series),
                "missing {series}"
            );
        }
        assert_unique_periods(&metrics);
    }

    #[test]
    #[ignore = "live NASS contract check requires a QuickStats API key"]
    fn live_nass_contract() {
        if !has_secret("usda-nass") {
            return;
        }
        let records = tauri::async_runtime::block_on(NassSource.fetch()).unwrap();
        assert!(!records.is_empty());
    }

    #[test]
    #[ignore = "live FAS contract check requires an API.Data.gov key"]
    fn live_fas_contract() {
        if !has_secret("usda-fas") {
            return;
        }
        let records = tauri::async_runtime::block_on(FasSource.fetch()).unwrap();
        assert!(!records.is_empty());
    }
}
