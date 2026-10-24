use chrono::{DateTime, Utc};
use databento::{
    Error as DatabentoError, HistoricalClient,
    dbn::{Dataset, FIXED_PRICE_SCALE, OhlcvMsg, SType, Schema, UNDEF_PRICE},
    historical::timeseries::GetRangeParams,
};
use keyring::{Entry, Error as KeyringError};
use time::OffsetDateTime;

use crate::core::{
    Cadence, DataSource, Observation, SeriesId, SourceError, SourceId, SourceRecord, Unit,
};

const KEYRING_SERVICE: &str = "com.williammcdowell.agri-terminal";
const KEYRING_ACCOUNT: &str = "databento-api-key";

/// CME grain roots whose continuous front-month series are requested.
const CONTRACTS: [&str; 3] = ["ZC", "ZS", "ZW"];

pub struct DatabentoSource;

#[async_trait::async_trait]
impl DataSource for DatabentoSource {
    fn id(&self) -> &'static str {
        "databento"
    }
    fn name(&self) -> &'static str {
        "Databento · GLBX.MDP3"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Daily
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let mut records = Vec::new();
        for contract in CONTRACTS {
            records.extend(
                fetch_daily(contract, None, None)
                    .await?
                    .into_iter()
                    .map(SourceRecord::Price),
            );
        }
        Ok(records)
    }
}

pub fn save_api_key(key: &str) -> Result<(), SourceError> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(SourceError::Auth);
    }
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| SourceError::Unavailable(error.to_string()))?
        .set_password(trimmed)
        .map_err(|error| SourceError::Unavailable(error.to_string()))
}

pub fn has_api_key() -> bool {
    api_key().is_ok()
}

fn api_key() -> Result<String, SourceError> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| SourceError::Unavailable(error.to_string()))?;
    entry.get_password().map_err(|error| match error {
        KeyringError::NoEntry => SourceError::Auth,
        other => SourceError::Unavailable(other.to_string()),
    })
}

pub async fn fetch_daily(
    root: &str,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
) -> Result<Vec<Observation>, SourceError> {
    let key = api_key()?;
    let now = Utc::now();
    let start = start.unwrap_or_else(|| now - chrono::Duration::days(30));
    let end = end.unwrap_or(now);
    if start >= end {
        return Err(SourceError::Parse(
            "The requested start must be before the end".into(),
        ));
    }

    let mut client = HistoricalClient::builder()
        .key(&key)
        .map_err(|_| SourceError::Auth)?
        .build()
        .map_err(|error| SourceError::Unavailable(error.to_string()))?;
    let params = GetRangeParams::builder()
        .dataset(Dataset::GlbxMdp3)
        .symbols(format!("{root}.c.0"))
        .stype_in(SType::Continuous)
        .schema(Schema::Ohlcv1D)
        .date_time_range(
            OffsetDateTime::from_unix_timestamp(start.timestamp())
                .map_err(|error| SourceError::Parse(error.to_string()))?
                ..OffsetDateTime::from_unix_timestamp(end.timestamp())
                    .map_err(|error| SourceError::Parse(error.to_string()))?,
        )
        .build();
    let mut decoder = client
        .timeseries()
        .get_range(&params)
        .await
        .map_err(classify_request_error)?;

    let fetched_at = Utc::now();
    let mut observations = Vec::new();
    while let Some(record) = decoder
        .decode_record::<OhlcvMsg>()
        .await
        .map_err(|error| SourceError::Parse(error.to_string()))?
    {
        if let Some(observation) = decode_ohlcv(
            root,
            record.hd.ts_event,
            record.open,
            record.high,
            record.low,
            record.close,
            fetched_at,
        )? {
            observations.push(observation);
        }
    }
    Ok(observations)
}

fn decode_ohlcv(
    root: &str,
    ts_event: u64,
    open: i64,
    high: i64,
    low: i64,
    close: i64,
    fetched_at: DateTime<Utc>,
) -> Result<Option<Observation>, SourceError> {
    if [open, high, low, close].contains(&UNDEF_PRICE) {
        return Ok(None);
    }
    let seconds = i64::try_from(ts_event / 1_000_000_000)
        .map_err(|error| SourceError::Parse(error.to_string()))?;
    let event_time = DateTime::<Utc>::from_timestamp(seconds, 0)
        .ok_or_else(|| SourceError::Parse("Invalid Databento event timestamp".into()))?;
    let scale = FIXED_PRICE_SCALE as f64;
    Ok(Some(Observation {
        series_id: SeriesId::from(format!("price.{root}.close")),
        period: event_time.date_naive(),
        // The historical API doesn't include exact first-publication time; use fetch time as a conservative as-of boundary.
        released_at: fetched_at,
        // CME corn futures are quoted in cents per bushel; normalize to USD/bushel.
        open: open as f64 / scale / 100.0,
        high: high as f64 / scale / 100.0,
        low: low as f64 / scale / 100.0,
        close: close as f64 / scale / 100.0,
        unit: Unit::UsdPerBushel,
        source_id: SourceId::from("databento"),
        fetched_at,
        revision: 0,
    }))
}

fn classify_request_error(error: DatabentoError) -> SourceError {
    match error {
        DatabentoError::Auth(_) => SourceError::Auth,
        DatabentoError::Api(api_error) => match api_error.status_code.as_u16() {
            401 | 403 => SourceError::Auth,
            429 => SourceError::RateLimited { retry_after: None },
            _ => SourceError::Transient(api_error.to_string()),
        },
        other => SourceError::Transient(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    const SYNTHETIC_OHLCV: &str =
        include_str!("../../../tests/fixtures/databento_ohlcv_synthetic.csv");

    #[test]
    fn decodes_synthetic_daily_ohlcv_fixture() {
        let fetched_at = DateTime::parse_from_rfc3339("2026-10-24T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut reader = csv::Reader::from_reader(SYNTHETIC_OHLCV.as_bytes());
        let row = reader.records().next().unwrap().unwrap();
        let ts_event = row[0].parse::<u64>().unwrap();
        let prices = (1..=4)
            .map(|index| row[index].parse::<i64>().unwrap())
            .collect::<Vec<_>>();
        let bar = decode_ohlcv(
            "ZC", ts_event, prices[0], prices[1], prices[2], prices[3], fetched_at,
        )
        .unwrap()
        .unwrap();
        assert_eq!(bar.period, NaiveDate::from_ymd_opt(2026, 10, 23).unwrap());
        assert_eq!(
            (bar.open, bar.high, bar.low, bar.close),
            (4.5, 4.6, 4.4, 4.55)
        );
        assert_eq!(bar.series_id.0, "price.ZC.close");
        assert_eq!(bar.source_id.0, "databento");
        assert_eq!(bar.released_at, fetched_at);
    }
}
