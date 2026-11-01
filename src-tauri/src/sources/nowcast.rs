//! The crop nowcast's text outputs: the weekly brief and crop damage events, which do not fit
//! numeric series. The yield and acreage numbers come from the bundled `crop-nowcast-*`
//! manifests. All of them read the files in `docs/nowcast-data-contract.md`, and these requests go
//! through the plugin HTTP client, so they keep to the same host, size and timeout limits.

use chrono::{DateTime, Utc};
use serde_json::Value;
use url::Url;

use crate::{
    core::{Cadence, DataSource, DocumentRecord, SourceError, SourceId, SourceRecord},
    plugins::http::{self, HostPolicy, Limits, REQUEST_TIMEOUT},
};

pub const SOURCE_ID: &str = "crop-nowcast-brief";
pub const SOURCE_NAME: &str = "Crop nowcast · brief and damage events (sample)";
pub const BRIEF_DATASET: &str = "nowcast.brief";
pub const DAMAGE_EVENTS_DATASET: &str = "nowcast.damage_events";
/// The synthetic sample output until Phase 8 points this at `billymcdowell/agri-terminal-data`.
const BASE_URL: &str = "https://raw.githubusercontent.com/billymcdowell/agri-terminal/master/pipelines/crop-nowcast/sample_output/latest/";
const HOST: &str = "raw.githubusercontent.com";
const MAX_BYTES: usize = 1024 * 1024;

pub struct NowcastBriefSource;

#[async_trait::async_trait]
impl DataSource for NowcastBriefSource {
    fn id(&self) -> &str {
        SOURCE_ID
    }
    fn name(&self) -> &str {
        SOURCE_NAME
    }
    fn cadence(&self) -> Cadence {
        Cadence::Weekly
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let brief = fetch_file("brief.json").await?;
        let events = fetch_file("damage_events.json").await?;
        let now = Utc::now();
        let mut records = vec![SourceRecord::Document(parse_brief(&brief, now)?)];
        records.extend(
            parse_damage_events(&events, now)?
                .into_iter()
                .map(SourceRecord::Document),
        );
        Ok(records)
    }
}

async fn fetch_file(name: &str) -> Result<Vec<u8>, SourceError> {
    let url = Url::parse(BASE_URL)
        .and_then(|base| base.join(name))
        .map_err(|error| SourceError::Parse(format!("nowcast URL: {error}")))?;
    let limits = Limits {
        max_bytes: MAX_BYTES,
        timeout: REQUEST_TIMEOUT,
    };
    http::get(&HostPolicy::new(&[HOST.to_string()]), &limits, url, &[]).await
}

/// The document's `published_at`, never later than the fetch, so it is never treated as public
/// before it could have been read.
fn published_at(
    document: &Value,
    what: &str,
    fetched: DateTime<Utc>,
) -> Result<(String, DateTime<Utc>), SourceError> {
    let text = document
        .get("published_at")
        .and_then(Value::as_str)
        .ok_or_else(|| SourceError::Parse(format!("{what} has no published_at")))?;
    let time = DateTime::parse_from_rfc3339(text).map_err(|_| {
        SourceError::Parse(format!(
            "{what}: could not read published_at \"{text}\" as a time"
        ))
    })?;
    Ok((text.to_string(), time.with_timezone(&Utc).min(fetched)))
}

/// One brief per publish, keyed by its `published_at`.
pub fn parse_brief(body: &[u8], fetched: DateTime<Utc>) -> Result<DocumentRecord, SourceError> {
    let document: Value = serde_json::from_slice(body)
        .map_err(|error| SourceError::Parse(format!("brief.json: {error}")))?;
    if document.get("summary").and_then(Value::as_str).is_none() {
        return Err(SourceError::Parse(
            "brief.json must be an object with a summary".into(),
        ));
    }
    let (doc_id, published_at) = published_at(&document, "brief.json", fetched)?;
    Ok(DocumentRecord {
        dataset: BRIEF_DATASET.into(),
        doc_id,
        published_at,
        document,
        source_id: SourceId::from(SOURCE_ID),
        fetched_at: fetched,
        revision: 0,
    })
}

/// Every event in the file, keyed by its `id`. One unreadable event fails the whole file, so a
/// changed format shows up as an error rather than as missing events.
pub fn parse_damage_events(
    body: &[u8],
    fetched: DateTime<Utc>,
) -> Result<Vec<DocumentRecord>, SourceError> {
    let parsed: Value = serde_json::from_slice(body)
        .map_err(|error| SourceError::Parse(format!("damage_events.json: {error}")))?;
    let Value::Array(events) = parsed else {
        return Err(SourceError::Parse(
            "damage_events.json must be a JSON array".into(),
        ));
    };
    events
        .into_iter()
        .enumerate()
        .map(|(index, event)| {
            let id = event
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| {
                    SourceError::Parse(format!("damage_events.json event {index} has no id"))
                })?
                .to_string();
            let (_, published_at) = published_at(&event, &format!("damage event {id}"), fetched)?;
            Ok(DocumentRecord {
                dataset: DAMAGE_EVENTS_DATASET.into(),
                doc_id: id,
                published_at,
                document: event,
                source_id: SourceId::from(SOURCE_ID),
                fetched_at: fetched,
                revision: 0,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        core::{SeriesKind, StoredRows},
        store,
    };

    const LATEST_BRIEF: &str =
        include_str!("../../../pipelines/crop-nowcast/sample_output/latest/brief.json");
    const LATEST_EVENTS: &str =
        include_str!("../../../pipelines/crop-nowcast/sample_output/latest/damage_events.json");
    const EARLIER_EVENTS: &str =
        include_str!("../../../pipelines/crop-nowcast/sample_output/2026-08-11/damage_events.json");

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn the_sample_brief_is_kept_whole_with_its_publish_time() {
        let brief = parse_brief(LATEST_BRIEF.as_bytes(), at("2026-08-20T00:00:00Z")).unwrap();
        assert_eq!(brief.dataset, "nowcast.brief");
        assert_eq!(brief.doc_id, "2026-08-18T18:00:00Z");
        assert_eq!(brief.published_at, at("2026-08-18T18:00:00Z"));
        assert!(
            brief.document["summary"]
                .as_str()
                .unwrap()
                .starts_with("Sample data")
        );
        assert_eq!(brief.document["model_version"], "sample-0.1.0");
        assert_eq!(brief.document["bullets"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn sample_damage_events_are_keyed_by_id() {
        let events =
            parse_damage_events(LATEST_EVENTS.as_bytes(), at("2026-08-20T00:00:00Z")).unwrap();
        assert_eq!(
            events
                .iter()
                .map(|event| (event.doc_id.as_str(), event.published_at.to_rfc3339()))
                .collect::<Vec<_>>(),
            vec![
                (
                    "sample-2026-07-14-ne-hail",
                    "2026-07-21T18:00:00+00:00".into()
                ),
                (
                    "sample-2026-08-04-ia-wind",
                    "2026-08-18T18:00:00+00:00".into()
                ),
            ]
        );
        assert!(
            events
                .iter()
                .all(|event| event.dataset == "nowcast.damage_events")
        );
    }

    #[test]
    fn a_publish_time_after_the_fetch_becomes_the_fetch_time() {
        let fetched = at("2026-08-01T00:00:00Z");
        let brief = parse_brief(LATEST_BRIEF.as_bytes(), fetched).unwrap();
        assert_eq!(brief.published_at, fetched);
        assert_eq!(brief.doc_id, "2026-08-18T18:00:00Z");
    }

    #[test]
    fn malformed_files_are_errors_not_empty_results() {
        let fetched = at("2026-08-20T00:00:00Z");
        for (body, message) in [
            ("[]", "must be an object with a summary"),
            (
                r#"{"summary":"x","published_at":"soon"}"#,
                "could not read published_at \"soon\"",
            ),
            (r#"{"summary":"x"}"#, "brief.json has no published_at"),
        ] {
            let error = parse_brief(body.as_bytes(), fetched).unwrap_err();
            assert!(error.to_string().contains(message), "{error}");
        }
        for (body, message) in [
            ("{}", "must be a JSON array"),
            (
                r#"[{"published_at":"2026-08-18T18:00:00Z"}]"#,
                "event 0 has no id",
            ),
            (r#"[{"id":"a"}]"#, "damage event a has no published_at"),
        ] {
            let error = parse_damage_events(body.as_bytes(), fetched).unwrap_err();
            assert!(error.to_string().contains(message), "{error}");
        }
    }

    /// What the RAW panel lists after refreshing the three crop nowcast sources against the
    /// sample output, using the same parsing and storage as a real refresh.
    #[test]
    fn the_sample_output_appears_in_the_raw_data_listing() {
        let directory =
            std::env::temp_dir().join(format!("agri-nowcast-raw-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let connection = store::open(&directory.join("test.sqlite3")).unwrap();
        let plugins = crate::plugins::registry::load_all(&directory.join("plugins"));
        let manifest = |id: &str| {
            plugins
                .iter()
                .find_map(|item| item.manifest.clone().filter(|manifest| manifest.id == id))
                .unwrap()
        };
        let earlier = at("2026-08-12T00:00:00Z");
        let later = at("2026-08-20T00:00:00Z");
        let mut records = Vec::new();
        for (id, body) in [
            (
                "crop-nowcast-yield",
                include_str!("../../../pipelines/crop-nowcast/sample_output/latest/yield.csv"),
            ),
            (
                "crop-nowcast-acreage",
                include_str!("../../../pipelines/crop-nowcast/sample_output/latest/acreage.csv"),
            ),
        ] {
            records.extend(
                crate::plugins::source::extract(&manifest(id), body.as_bytes(), later)
                    .unwrap()
                    .into_iter()
                    .map(SourceRecord::Metric),
            );
        }
        // The 11 August publish first, then the 18 August one that restates the wind event.
        for event in parse_damage_events(EARLIER_EVENTS.as_bytes(), earlier).unwrap() {
            records.push(SourceRecord::Document(event));
        }
        store::append_source_records(&connection, &records).unwrap();
        let mut latest = vec![SourceRecord::Document(
            parse_brief(LATEST_BRIEF.as_bytes(), later).unwrap(),
        )];
        latest.extend(
            parse_damage_events(LATEST_EVENTS.as_bytes(), later)
                .unwrap()
                .into_iter()
                .map(SourceRecord::Document),
        );
        store::append_source_records(&connection, &latest).unwrap();

        let listed = store::list_stored_series(&connection).unwrap();
        let entry = |id: &str| {
            listed
                .iter()
                .find(|series| series.series_id.0 == id)
                .unwrap_or_else(|| panic!("{id} is not listed"))
        };
        assert_eq!(
            entry("nowcast.corn.us.yield_p50").source_id.0,
            "crop-nowcast-yield"
        );
        assert_eq!(entry("nowcast.corn.us.yield_p50").rows, 10);
        assert_eq!(
            entry("nowcast.soybeans.mo.acres_p50").source_id.0,
            "crop-nowcast-acreage"
        );
        assert_eq!(entry("nowcast.brief").kind, SeriesKind::Document);
        assert_eq!(entry("nowcast.brief").source_id.0, "crop-nowcast-brief");
        assert_eq!(entry("nowcast.damage_events").rows, 3);

        let StoredRows::Document(events) =
            store::query_stored_rows(&connection, "nowcast.damage_events").unwrap()
        else {
            panic!("damage events are documents");
        };
        let wind: Vec<_> = events
            .iter()
            .filter(|event| event.doc_id == "sample-2026-08-04-ia-wind")
            .map(|event| (event.revision, event.document["affected_acres_p50"].clone()))
            .collect();
        assert_eq!(wind, vec![(0, 320_000.into()), (1, 290_000.into())]);
        drop(connection);
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    #[ignore = "live check that the published sample output is reachable; run in nightly CI"]
    fn live_crop_nowcast_sample_contract() {
        let records = tauri::async_runtime::block_on(NowcastBriefSource.fetch()).unwrap();
        assert!(records.iter().any(|record| matches!(
            record,
            SourceRecord::Document(document) if document.dataset == BRIEF_DATASET
        )));
        let directory =
            std::env::temp_dir().join(format!("agri-nowcast-live-{}", std::process::id()));
        for id in ["crop-nowcast-yield", "crop-nowcast-acreage"] {
            let source = crate::plugins::registry::find_source(&directory, id).unwrap();
            let rows = tauri::async_runtime::block_on(source.fetch()).unwrap();
            assert!(!rows.is_empty(), "{id} returned nothing");
        }
    }
}
