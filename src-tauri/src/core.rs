use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(transparent)]
pub struct SeriesId(pub String);

impl From<&str> for SeriesId {
    fn from(value: &str) -> Self {
        Self(value.into())
    }
}

impl From<String> for SeriesId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(transparent)]
pub struct SourceId(pub String);

impl From<&str> for SourceId {
    fn from(value: &str) -> Self {
        Self(value.into())
    }
}

impl From<String> for SourceId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[derive(Clone, Debug, Serialize)]
pub enum Unit {
    #[serde(rename = "USD/bushel")]
    UsdPerBushel,
}

impl Unit {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UsdPerBushel => "USD/bushel",
        }
    }

    pub fn from_storage(value: &str) -> Result<Self, String> {
        match value {
            "USD/bushel" | "usd_per_bushel" => Ok(Self::UsdPerBushel),
            other => Err(format!("Unknown observation unit: {other}")),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    #[error("Authentication is required or was rejected")]
    Auth,
    #[error("The source rate limited this request")]
    RateLimited { retry_after: Option<DateTime<Utc>> },
    #[error("Temporary source error: {0}")]
    Transient(String),
    #[error("Could not parse source data: {0}")]
    Parse(String),
    #[error("Source is unavailable: {0}")]
    Unavailable(String),
}

#[async_trait::async_trait]
pub trait DataSource: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn cadence(&self) -> Cadence;
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError>;
}

#[derive(Clone, Copy, Debug)]
pub enum Cadence {
    Daily,
    Weekly,
}

impl Cadence {
    pub fn seconds(self) -> i64 {
        match self {
            Self::Daily => 86_400,
            Self::Weekly => 604_800,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", content = "observation", rename_all = "camelCase")]
pub enum SourceRecord {
    Price(Observation),
    Metric(MetricObservation),
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SeriesKind {
    Price,
    Metric,
}

/// A stored series and the source that wrote it, for browsing raw rows.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSeries {
    pub series_id: SeriesId,
    pub source_id: SourceId,
    pub kind: SeriesKind,
    /// Every stored revision, not just the newest of each period.
    pub rows: i64,
    pub first_period: NaiveDate,
    pub last_period: NaiveDate,
    pub last_fetched_at: DateTime<Utc>,
}

/// Every stored revision of one series, oldest period first.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", content = "rows", rename_all = "camelCase")]
pub enum StoredRows {
    Price(Vec<Observation>),
    Metric(Vec<MetricObservation>),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricObservation {
    pub series_id: SeriesId,
    pub period: NaiveDate,
    pub released_at: DateTime<Utc>,
    pub value: f64,
    pub unit: String,
    pub source_id: SourceId,
    pub fetched_at: DateTime<Utc>,
    pub revision: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub series_id: SeriesId,
    pub period: NaiveDate,
    pub released_at: DateTime<Utc>,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub unit: Unit,
    pub source_id: SourceId,
    pub fetched_at: DateTime<Utc>,
    pub revision: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub source_id: SourceId,
    pub name: String,
    pub state: String,
    pub last_ok: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub is_demo: bool,
    pub last_attempt: Option<DateTime<Utc>>,
    pub next_expected: Option<DateTime<Utc>>,
    pub enabled: bool,
    pub cadence_seconds: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub kind: String,
    pub scheduled_at: DateTime<Utc>,
    pub commodity: Option<String>,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherForecast {
    pub region_id: String,
    pub region_name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub provider: String,
    pub valid_at: DateTime<Utc>,
    pub temperature_c: Option<f64>,
    pub precipitation_mm: Option<f64>,
    pub precipitation_probability: Option<f64>,
    pub wind_kph: Option<f64>,
    pub relative_humidity: Option<f64>,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub title: String,
    pub source: String,
    pub published_at: DateTime<Utc>,
    pub url: String,
    pub commodity: String,
}

/// Cached forecasts for a commodity's growing regions and when they were fetched.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherSnapshot {
    pub fetched_at: Option<DateTime<Utc>>,
    pub forecasts: Vec<WeatherForecast>,
}
