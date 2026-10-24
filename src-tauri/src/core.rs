use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

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
    fn id(&self) -> &'static str;
    async fn fetch(&self) -> Result<Vec<Observation>, SourceError>;
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
}
