//! File exports. Files are written under the app data directory, never to a caller-chosen path.

use std::path::{Path, PathBuf};

use crate::core::{MetricObservation, Observation};

/// Keeps a name to safe filename characters so it cannot escape the export directory.
pub fn safe_file_name(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(|c| c == '.' || c == '-').to_string();
    if cleaned.is_empty() {
        return Err("Export needs a file name".into());
    }
    Ok(cleaned)
}

pub fn write_export(directory: &Path, name: &str, content: &str) -> Result<PathBuf, String> {
    let file = safe_file_name(name)?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Create export directory: {error}"))?;
    let path = directory.join(file);
    std::fs::write(&path, content).map_err(|error| format!("Write export: {error}"))?;
    Ok(path)
}

pub fn prices_to_csv(rows: &[Observation]) -> Result<String, String> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "series_id",
            "period",
            "open",
            "high",
            "low",
            "close",
            "unit",
            "source",
            "released_at",
            "fetched_at",
            "revision",
        ])
        .map_err(|error| error.to_string())?;
    for row in rows {
        writer
            .write_record([
                row.series_id.0.clone(),
                row.period.to_string(),
                row.open.to_string(),
                row.high.to_string(),
                row.low.to_string(),
                row.close.to_string(),
                row.unit.as_str().to_string(),
                row.source_id.0.clone(),
                row.released_at.to_rfc3339(),
                row.fetched_at.to_rfc3339(),
                row.revision.to_string(),
            ])
            .map_err(|error| error.to_string())?;
    }
    into_string(writer)
}

pub fn metrics_to_csv(rows: &[MetricObservation]) -> Result<String, String> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "series_id",
            "period",
            "value",
            "unit",
            "source",
            "released_at",
            "fetched_at",
            "revision",
        ])
        .map_err(|error| error.to_string())?;
    for row in rows {
        writer
            .write_record([
                row.series_id.0.clone(),
                row.period.to_string(),
                row.value.to_string(),
                row.unit.clone(),
                row.source_id.0.clone(),
                row.released_at.to_rfc3339(),
                row.fetched_at.to_rfc3339(),
                row.revision.to_string(),
            ])
            .map_err(|error| error.to_string())?;
    }
    into_string(writer)
}

fn into_string(writer: csv::Writer<Vec<u8>>) -> Result<String, String> {
    String::from_utf8(writer.into_inner().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{SeriesId, SourceId};
    use chrono::{NaiveDate, Utc};

    #[test]
    fn file_names_cannot_escape_the_export_directory() {
        assert_eq!(
            safe_file_name("cot.ZC.managed_money_net.csv").unwrap(),
            "cot.ZC.managed_money_net.csv"
        );
        assert_eq!(safe_file_name("../../etc/passwd").unwrap(), "etc-passwd");
        assert_eq!(safe_file_name("a b/c").unwrap(), "a-b-c");
        assert!(safe_file_name("../..").is_err());
        assert!(safe_file_name("").is_err());
    }

    #[test]
    fn exports_are_written_inside_the_directory() {
        let directory = std::env::temp_dir().join(format!("agri-export-{}", std::process::id()));
        let path = write_export(&directory, "../escape.csv", "a,b\n").unwrap();
        assert_eq!(path.parent().unwrap(), directory);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a,b\n");
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn metric_csv_keeps_lineage_columns() {
        let at = Utc::now();
        let csv = metrics_to_csv(&[MetricObservation {
            series_id: SeriesId::from("cot.ZC.managed_money_net"),
            period: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            released_at: at,
            value: 164423.0,
            unit: "contracts".into(),
            source_id: SourceId::from("cftc-cot"),
            fetched_at: at,
            revision: 1,
        }])
        .unwrap();
        let mut lines = csv.lines();
        assert_eq!(
            lines.next().unwrap(),
            "series_id,period,value,unit,source,released_at,fetched_at,revision"
        );
        assert!(
            lines
                .next()
                .unwrap()
                .starts_with("cot.ZC.managed_money_net,2026-10-20,164423,contracts,cftc-cot,")
        );
    }
}
