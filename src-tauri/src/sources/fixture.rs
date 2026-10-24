use chrono::NaiveDate;

use crate::core::{
    Cadence, DataSource, Observation, SeriesId, SourceError, SourceId, SourceRecord, Unit,
};

const CORN_FIXTURE: &str = include_str!("../../../tests/fixtures/corn_daily.csv");

pub struct CornFixtureSource;

#[async_trait::async_trait]
impl DataSource for CornFixtureSource {
    fn id(&self) -> &'static str {
        "fixture-corn"
    }
    fn name(&self) -> &'static str {
        "Corn price fixture"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Daily
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        corn_daily_fixture()
            .map(|records| records.into_iter().map(SourceRecord::Price).collect())
            .map_err(SourceError::Parse)
    }
}

pub fn corn_daily_fixture() -> Result<Vec<Observation>, String> {
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
            series_id: SeriesId::from("demo.price.ZC.close"),
            period,
            released_at,
            open,
            high,
            low,
            close,
            unit: Unit::UsdPerBushel,
            source_id: SourceId::from("fixture-corn"),
            fetched_at: released_at,
            revision: 0,
        });
    }
    Ok(observations)
}
