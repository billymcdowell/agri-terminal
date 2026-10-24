use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub series_id: String,
    pub period: NaiveDate,
    pub released_at: DateTime<Utc>,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub unit: String,
    pub source_id: String,
    pub fetched_at: DateTime<Utc>,
    pub revision: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub source_id: String,
    pub name: String,
    pub state: String,
    pub last_ok: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub is_demo: bool,
}
