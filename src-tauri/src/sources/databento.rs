use chrono::{DateTime, NaiveDate, Utc};
use databento::{
    Error as DatabentoError, HistoricalClient,
    dbn::{Dataset, FIXED_PRICE_SCALE, OhlcvMsg, SType, Schema, UNDEF_PRICE},
    historical::timeseries::GetRangeParams,
};
use keyring::{Entry, Error as KeyringError};
use time::OffsetDateTime;

use crate::core::{DataSource, Observation, SeriesId, SourceError, SourceId, Unit};

const KEYRING_SERVICE: &str = "com.williammcdowell.agri-terminal";
const KEYRING_ACCOUNT: &str = "databento-api-key";

pub struct DatabentoSource;

#[async_trait::async_trait]
impl DataSource for DatabentoSource {
    fn id(&self) -> &'static str {
        "databento"
    }

    async fn fetch(&self) -> Result<Vec<Observation>, SourceError> {
        fetch_daily_corn(None, None).await
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

pub async fn fetch_daily_corn(
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
        .symbols("ZC.c.0")
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
        if [record.open, record.high, record.low, record.close].contains(&UNDEF_PRICE) {
            continue;
        }
        let seconds = i64::try_from(record.hd.ts_event / 1_000_000_000)
            .map_err(|error| SourceError::Parse(error.to_string()))?;
        let event_time = DateTime::<Utc>::from_timestamp(seconds, 0)
            .ok_or_else(|| SourceError::Parse("Invalid Databento event timestamp".into()))?;
        let period: NaiveDate = event_time.date_naive();
        let scale = FIXED_PRICE_SCALE as f64;
        observations.push(Observation {
            series_id: SeriesId::from("price.ZC.close"),
            period,
            // The historical API's exact first-publication time is not included in OHLCV records.
            // Use fetch time as a conservative availability boundary for as-of queries.
            released_at: fetched_at,
            // CME corn futures are quoted in U.S. cents per bushel; normalize to USD/bushel.
            open: record.open as f64 / scale / 100.0,
            high: record.high as f64 / scale / 100.0,
            low: record.low as f64 / scale / 100.0,
            close: record.close as f64 / scale / 100.0,
            unit: Unit::UsdPerBushel,
            source_id: SourceId::from("databento"),
            fetched_at,
            revision: 0,
        });
    }
    Ok(observations)
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
