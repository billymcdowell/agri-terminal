use std::path::{Path, PathBuf};

use serde::Serialize;

use super::manifest::{self, Manifest};
use super::source::{PluginSource, has_secret};
use crate::core::DataSource;

/// Manifests that ship with the app. They run through the same loader as installed plugins.
const BUILTIN: &[&str] = &[
    include_str!("../../../plugins/builtin/us-drought-monitor.toml"),
    include_str!("../../../plugins/builtin/usgs-river-stage.toml"),
    include_str!("../../../plugins/builtin/crop-nowcast-yield.toml"),
    include_str!("../../../plugins/builtin/crop-nowcast-acreage.toml"),
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub name: String,
    pub configured: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub license_note: String,
    pub builtin: bool,
    pub hosts: Vec<String>,
    pub secrets: Vec<SecretStatus>,
    pub series: Vec<String>,
    pub cadence: String,
    /// Problems that stop the manifest from loading; empty for a working plugin.
    pub errors: Vec<String>,
}

impl PluginSummary {
    /// Summary of a manifest that is not (yet) installed.
    pub fn of(manifest: &Manifest) -> Self {
        Self::from_manifest(manifest, false)
    }

    fn from_manifest(manifest: &Manifest, builtin: bool) -> Self {
        Self {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            license_note: manifest.license_note.clone(),
            builtin,
            hosts: manifest.permissions.hosts.clone(),
            secrets: manifest
                .permissions
                .secrets
                .iter()
                .map(|name| SecretStatus {
                    name: name.clone(),
                    configured: has_secret(&manifest.id, name),
                })
                .collect(),
            series: manifest
                .series
                .iter()
                .map(|series| series.id.clone())
                .collect(),
            cadence: manifest.source.cadence.clone(),
            errors: Vec::new(),
        }
    }

    fn broken(id: String, errors: Vec<String>) -> Self {
        Self {
            name: id.clone(),
            id,
            version: String::new(),
            description: String::new(),
            license_note: String::new(),
            builtin: false,
            hosts: Vec::new(),
            secrets: Vec::new(),
            series: Vec::new(),
            cadence: String::new(),
            errors,
        }
    }
}

pub struct Loaded {
    pub summary: PluginSummary,
    pub manifest: Option<Manifest>,
}

pub fn load_all(user_dir: &Path) -> Vec<Loaded> {
    let mut loaded = Vec::new();
    for text in BUILTIN {
        match manifest::load(text, true) {
            Ok(manifest) => loaded.push(Loaded {
                summary: PluginSummary::from_manifest(&manifest, true),
                manifest: Some(manifest),
            }),
            Err(errors) => loaded.push(Loaded {
                summary: PluginSummary::broken("builtin".into(), errors),
                manifest: None,
            }),
        }
    }
    let Ok(entries) = std::fs::read_dir(user_dir) else {
        return loaded;
    };
    let mut directories: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    directories.sort();
    for directory in directories {
        let name = directory
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let Ok(text) = std::fs::read_to_string(directory.join("plugin.toml")) else {
            continue;
        };
        match manifest::load(&text, false) {
            Ok(manifest) if manifest.id == name => {
                loaded.push(Loaded {
                    summary: PluginSummary::from_manifest(&manifest, false),
                    manifest: Some(manifest),
                });
            }
            Ok(manifest) => loaded.push(Loaded {
                summary: PluginSummary::broken(
                    name.clone(),
                    vec![format!(
                        "id: \"{}\" must match the folder name \"{name}\"",
                        manifest.id
                    )],
                ),
                manifest: None,
            }),
            Err(errors) => loaded.push(Loaded {
                summary: PluginSummary::broken(name, errors),
                manifest: None,
            }),
        }
    }
    loaded
}

pub fn find_source(user_dir: &Path, id: &str) -> Option<Box<dyn DataSource>> {
    load_all(user_dir)
        .into_iter()
        .find_map(|loaded| loaded.manifest.filter(|manifest| manifest.id == id))
        .map(|manifest| Box::new(PluginSource { manifest }) as Box<dyn DataSource>)
}

/// A plugin with an `[auth]` block runs only once its secret is saved.
pub fn is_configured(manifest: &Manifest) -> bool {
    manifest
        .auth
        .as_ref()
        .is_none_or(|auth| has_secret(&manifest.id, &auth.secret))
}

/// Validates and saves a manifest into `<user_dir>/<id>/plugin.toml`.
pub fn install(user_dir: &Path, text: &str) -> Result<Manifest, Vec<String>> {
    let manifest = manifest::load(text, false)?;
    let directory = user_dir.join(&manifest.id);
    std::fs::create_dir_all(&directory)
        .map_err(|error| vec![format!("Create plugin folder: {error}")])?;
    std::fs::write(directory.join("plugin.toml"), text)
        .map_err(|error| vec![format!("Write plugin: {error}")])?;
    Ok(manifest)
}

/// Removes an installed plugin's folder. Built-in plugins cannot be removed. Stored observations
/// are kept so their lineage stays intact.
pub fn remove(user_dir: &Path, id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("Invalid plugin id".into());
    }
    let directory = user_dir.join(id);
    if !directory.join("plugin.toml").is_file() {
        return Err(format!("No installed plugin {id}"));
    }
    std::fs::remove_dir_all(&directory).map_err(|error| format!("Remove plugin: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::manifest::tests_support::GOOD_MANIFEST;

    fn temp_dir(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("agri-plugins-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        directory
    }

    #[test]
    fn the_documented_template_is_a_valid_manifest() {
        let template = include_str!("../../../plugins/template/plugin.toml");
        let manifest =
            manifest::load(template, false).unwrap_or_else(|errors| panic!("{errors:?}"));
        assert_eq!(manifest.id, "my-plugin");
    }

    #[test]
    fn the_bundled_drought_manifest_loads_as_a_built_in() {
        let loaded = load_all(&temp_dir("none"));
        let drought = loaded
            .iter()
            .find(|item| item.summary.id == "us-drought-monitor")
            .expect("bundled manifest");
        assert!(drought.summary.builtin);
        assert!(
            drought.summary.errors.is_empty(),
            "{:?}",
            drought.summary.errors
        );
    }

    #[test]
    fn the_manifest_reproduces_the_former_rust_drought_connector() {
        let drought = load_all(&temp_dir("equiv"))
            .into_iter()
            .find(|item| item.summary.id == "us-drought-monitor")
            .unwrap()
            .manifest
            .unwrap();
        let fixture = include_str!("../../../tests/fixtures/drought_monitor_recorded.json");
        let fetched = chrono::DateTime::parse_from_rfc3339("2026-10-24T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let rows = crate::plugins::source::extract(&drought, fixture.as_bytes(), fetched).unwrap();
        assert_eq!(rows.len(), 10);
        let first = rows
            .iter()
            .find(|row| {
                row.series_id.0 == "drought.ia.D0" && row.period.to_string() == "2026-10-20"
            })
            .unwrap();
        assert_eq!(first.value, 1.35);
        assert_eq!(first.released_at, fetched);
        let older = rows
            .iter()
            .find(|row| {
                row.series_id.0 == "drought.ia.D0" && row.period.to_string() == "2026-10-13"
            })
            .unwrap();
        assert_eq!(older.released_at.to_rfc3339(), "2026-10-15T12:30:00+00:00");
        assert!(
            rows.iter()
                .all(|row| row.source_id.0 == "us-drought-monitor" && row.unit == "percent")
        );
    }

    #[test]
    fn the_drought_manifest_covers_exactly_the_configured_crop_states() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../config/crop-regions.json")).unwrap();
        let from_config: Vec<&str> = config["regions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|region| region["fips"].as_str().unwrap())
            .collect();
        let drought = load_all(&temp_dir("fips"))
            .into_iter()
            .find(|item| item.summary.id == "us-drought-monitor")
            .unwrap()
            .manifest
            .unwrap();
        assert_eq!(drought.request.vars["aoi"], from_config.join(","));
    }

    #[test]
    fn the_manifest_builds_the_request_the_rust_connector_made() {
        let drought = load_all(&temp_dir("request"))
            .into_iter()
            .find(|item| item.summary.id == "us-drought-monitor")
            .unwrap()
            .manifest
            .unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-24T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let (url, headers) = crate::plugins::source::build_request(&drought, now, None).unwrap();
        assert_eq!(url.host_str(), Some("usdmdataservices.unl.edu"));
        let query: std::collections::HashMap<_, _> = url
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(query["aoi"], "19,17,31,27,18,20,38,46,39");
        assert_eq!(query["startdate"], "10/24/2025");
        assert_eq!(query["enddate"], "10/24/2026");
        assert_eq!(query["statisticsType"], "1");
        assert_eq!(
            headers,
            vec![("Accept".to_string(), "application/json".to_string())]
        );
    }

    fn builtin(id: &str) -> Manifest {
        load_all(&temp_dir(id))
            .into_iter()
            .find(|item| item.summary.id == id)
            .and_then(|item| {
                assert!(item.summary.builtin && item.summary.errors.is_empty());
                item.manifest
            })
            .unwrap_or_else(|| panic!("bundled manifest {id}"))
    }

    #[test]
    fn the_nowcast_yield_manifest_reads_the_sample_output_with_publish_times() {
        let manifest = builtin("crop-nowcast-yield");
        let body = include_str!("../../../pipelines/crop-nowcast/sample_output/latest/yield.csv");
        let fetched = chrono::DateTime::parse_from_rfc3339("2026-08-20T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let rows = crate::plugins::source::extract(&manifest, body.as_bytes(), fetched).unwrap();
        let find = |id: &str, period: &str| {
            rows.iter()
                .find(|row| row.series_id.0 == id && row.period.to_string() == period)
                .unwrap_or_else(|| panic!("{id} {period}"))
        };
        // corn, US, week ending 2026-08-16, published 2026-08-18T18:00:00Z
        let p50 = find("nowcast.corn.us.yield_p50", "2026-08-16");
        assert_eq!(p50.value, 183.0);
        assert_eq!(p50.unit, "bu/acre");
        assert_eq!(p50.released_at.to_rfc3339(), "2026-08-18T18:00:00+00:00");
        assert_eq!(
            find("nowcast.corn.us.yield_gap_p50", "2026-08-16").value,
            -0.4
        );
        assert_eq!(
            find("nowcast.soybeans.ia.yield_usda_latest", "2026-08-16").value,
            58.5
        );
        // The first week was published in June, long before this fetch.
        assert_eq!(
            find("nowcast.corn.ia.yield_p10", "2026-06-14")
                .released_at
                .to_rfc3339(),
            "2026-06-16T18:00:00+00:00"
        );
        // State rows have no USDA yield before the August Crop Production report.
        let crop_production_week = chrono::NaiveDate::from_ymd_opt(2026, 8, 16).unwrap();
        assert!(!rows.iter().any(|row| {
            row.series_id.0 == "nowcast.corn.ia.yield_usda_latest"
                && row.period < crop_production_week
        }));
        assert!(
            rows.iter()
                .all(|row| row.source_id.0 == "crop-nowcast-yield")
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.series_id.0.ends_with(".yield_p50"))
                .count(),
            2 * 11 * 10
        );
    }

    #[test]
    fn the_nowcast_acreage_manifest_reads_the_sample_output() {
        let manifest = builtin("crop-nowcast-acreage");
        let body = include_str!("../../../pipelines/crop-nowcast/sample_output/latest/acreage.csv");
        let fetched = chrono::DateTime::parse_from_rfc3339("2026-08-20T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let rows = crate::plugins::source::extract(&manifest, body.as_bytes(), fetched).unwrap();
        let first = rows
            .iter()
            .find(|row| {
                row.series_id.0 == "nowcast.corn.us.acres_p50"
                    && row.period.to_string() == "2026-06-14"
            })
            .unwrap();
        assert_eq!(first.value, 93_500_000.0);
        assert_eq!(first.unit, "acres");
        assert_eq!(first.released_at.to_rfc3339(), "2026-06-16T18:00:00+00:00");
        assert_eq!(rows.len(), 2 * 11 * 10 * 4);
    }

    #[test]
    fn the_nowcast_manifests_cover_the_configured_crop_states() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../config/crop-regions.json")).unwrap();
        let body = include_str!("../../../pipelines/crop-nowcast/sample_output/latest/yield.csv");
        for region in config["regions"].as_array().unwrap() {
            let state = region["id"].as_str().unwrap().to_uppercase();
            assert!(
                body.contains(&format!(",corn,{state},")),
                "{state} is in config/crop-regions.json but not in the sample output"
            );
        }
    }

    fn usgs_stage_manifest() -> Manifest {
        load_all(&temp_dir("usgs"))
            .into_iter()
            .find(|item| item.summary.id == "usgs-river-stage")
            .expect("bundled manifest")
            .manifest
            .expect("valid manifest")
    }

    #[test]
    fn the_usgs_stage_manifest_reads_the_recorded_response() {
        let manifest = usgs_stage_manifest();
        let fixture =
            include_str!("../../../tests/fixtures/river/usgs_daily_stage_stlouis_recorded.json");
        let fetched = chrono::DateTime::parse_from_rfc3339("2026-10-31T21:30:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let rows = crate::plugins::source::extract(&manifest, fixture.as_bytes(), fetched).unwrap();
        assert_eq!(rows.len(), 7);
        assert!(
            rows.iter()
                .all(|row| row.series_id.0 == "river.stlouis.stage"
                    && row.unit == "ft"
                    && row.source_id.0 == "usgs-river-stage")
        );
        let first = rows
            .iter()
            .find(|row| row.period.to_string() == "2026-10-24")
            .unwrap();
        assert_eq!(first.value, 8.11);
        assert_eq!(first.released_at.to_rfc3339(), "2026-10-24T16:00:00+00:00");
        let last = rows
            .iter()
            .find(|row| row.period.to_string() == "2026-10-30")
            .unwrap();
        assert_eq!(last.value, 4.72);
        assert_eq!(last.released_at, fetched);
    }

    #[test]
    fn the_usgs_stage_manifest_asks_for_six_years_at_the_configured_site() {
        let manifest = usgs_stage_manifest();
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-31T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let (url, _) = crate::plugins::source::build_request(&manifest, now, None).unwrap();
        let query: std::collections::HashMap<_, _> = url
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(url.host_str(), Some("api.waterdata.usgs.gov"));
        assert_eq!(query["datetime"], "2020-10-22/2026-10-31");
        assert_eq!(query["statistic_id"], "30800");
        let config =
            crate::sources::river::parse_waterways(crate::sources::river::BUNDLED_WATERWAYS)
                .unwrap();
        let usgs_gauges: Vec<_> = config
            .gauges()
            .filter(|(_, gauge)| gauge.stage_source == "usgs-river-stage")
            .map(|(_, gauge)| gauge)
            .collect();
        assert_eq!(usgs_gauges.len(), 1, "one manifest covers one gauge");
        assert_eq!(
            query["monitoring_location_id"],
            format!("USGS-{}", usgs_gauges[0].usgs_site.as_deref().unwrap())
        );
        assert_eq!(manifest.series[0].id, usgs_gauges[0].stage_series());
    }

    #[test]
    #[ignore = "live USGS contract check for the river stage manifest; run in nightly CI"]
    fn live_usgs_stage_manifest_contract() {
        let source = find_source(&temp_dir("live-usgs"), "usgs-river-stage").unwrap();
        let records = tauri::async_runtime::block_on(source.fetch()).unwrap();
        // Six years of daily readings, allowing for a few missing days.
        assert!(records.len() > 2000, "only {} rows", records.len());
    }

    #[test]
    #[ignore = "live Drought Monitor contract check for the manifest; run in nightly CI"]
    fn live_drought_manifest_contract() {
        let source = find_source(&temp_dir("live"), "us-drought-monitor").unwrap();
        let records = tauri::async_runtime::block_on(source.fetch()).unwrap();
        let ids: std::collections::HashSet<_> = records
            .iter()
            .filter_map(|record| match record {
                crate::core::SourceRecord::Metric(row) => Some(row.series_id.0.clone()),
                _ => None,
            })
            .collect();
        for expected in ["drought.ia.D0", "drought.ks.D4", "drought.oh.D2"] {
            assert!(ids.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn install_load_and_remove_round_trip() {
        let directory = temp_dir("roundtrip");
        install(&directory, GOOD_MANIFEST).unwrap();
        let loaded = load_all(&directory);
        let installed = loaded
            .iter()
            .find(|item| item.summary.id == "example-weather")
            .unwrap();
        assert!(!installed.summary.builtin);
        assert_eq!(installed.summary.hosts, vec!["api.example.com"]);
        assert!(find_source(&directory, "example-weather").is_some());
        remove(&directory, "example-weather").unwrap();
        assert!(find_source(&directory, "example-weather").is_none());
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn invalid_manifests_are_never_written_and_built_ins_cannot_be_removed() {
        let directory = temp_dir("invalid");
        assert!(
            install(
                &directory,
                &GOOD_MANIFEST.replace("api.example.com\"]", "127.0.0.1\"]")
            )
            .is_err()
        );
        assert!(!directory.exists());
        assert!(remove(&directory, "us-drought-monitor").is_err());
        assert!(remove(&directory, "../etc").is_err());
    }

    #[test]
    fn a_broken_plugin_folder_is_listed_with_its_errors() {
        let directory = temp_dir("broken");
        std::fs::create_dir_all(directory.join("bad-one")).unwrap();
        std::fs::write(
            directory.join("bad-one/plugin.toml"),
            GOOD_MANIFEST.replace("cadence = \"daily\"", "cadence = \"hourly\""),
        )
        .unwrap();
        std::fs::create_dir_all(directory.join("mismatch")).unwrap();
        std::fs::write(directory.join("mismatch/plugin.toml"), GOOD_MANIFEST).unwrap();
        let loaded = load_all(&directory);
        let bad = loaded
            .iter()
            .find(|item| item.summary.id == "bad-one")
            .unwrap();
        assert!(bad.manifest.is_none() && bad.summary.errors[0].contains("source.cadence"));
        let mismatch = loaded
            .iter()
            .find(|item| item.summary.id == "mismatch")
            .unwrap();
        assert!(mismatch.summary.errors[0].contains("must match the folder name"));
        assert!(find_source(&directory, "mismatch").is_none());
        let _ = std::fs::remove_dir_all(&directory);
    }
}
