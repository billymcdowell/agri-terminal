use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde_json::Value;
use url::Url;

use super::{
    http::{self, HostPolicy, Limits, REQUEST_TIMEOUT},
    manifest::Manifest,
    template,
};
use crate::{
    core::{Cadence, DataSource, MetricObservation, SourceError, SourceRecord},
    sources::fundamentals::{metric, parse_value, scheduled_release},
};

const KEYRING_SERVICE: &str = "uk.billymcdowell.agri-terminal";

/// A plugin's secrets live under their own keychain names so they can never collide with, or
/// read, the app's own keys.
pub fn secret_account(plugin_id: &str, secret: &str) -> String {
    format!("plugin:{plugin_id}:{secret}")
}

pub fn read_secret(plugin_id: &str, secret: &str) -> Result<String, SourceError> {
    keyring::Entry::new(KEYRING_SERVICE, &secret_account(plugin_id, secret))
        .map_err(|error| SourceError::Unavailable(error.to_string()))?
        .get_password()
        .map_err(|error| match error {
            keyring::Error::NoEntry => SourceError::Auth,
            other => SourceError::Unavailable(other.to_string()),
        })
}

pub fn has_secret(plugin_id: &str, secret: &str) -> bool {
    read_secret(plugin_id, secret).is_ok()
}

pub fn save_secret(plugin_id: &str, secret: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &secret_account(plugin_id, secret))
        .map_err(|error| error.to_string())?
        .set_password(value.trim())
        .map_err(|error| error.to_string())
}

pub struct PluginSource {
    pub manifest: Manifest,
}

/// Expands the URL template and applies authentication. Values substituted into the URL are
/// percent-encoded, so a variable cannot add parameters or change the path structure.
pub fn build_request(
    manifest: &Manifest,
    now: DateTime<Utc>,
    secret: Option<&str>,
) -> Result<(Url, Vec<(String, String)>), SourceError> {
    let lookup =
        |name: &str| {
            manifest.request.vars.get(name).map(|value| {
                url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>()
            })
        };
    let text = template::render(&manifest.request.url, now, &lookup).map_err(SourceError::Parse)?;
    let mut url =
        Url::parse(&text).map_err(|error| SourceError::Parse(format!("request.url: {error}")))?;
    let mut headers: Vec<(String, String)> = manifest
        .request
        .headers
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if let (Some(auth), Some(secret)) = (&manifest.auth, secret) {
        match auth.kind.as_str() {
            "header" => headers.push((auth.name.clone(), secret.to_string())),
            _ => {
                url.query_pairs_mut().append_pair(&auth.name, secret);
            }
        }
    }
    Ok((url, headers))
}

fn row_field(row: &Value, path: &str) -> Option<String> {
    let mut current = row;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    match current {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn parse_period(text: &str, format: Option<&str>) -> Option<NaiveDate> {
    let text = text.trim();
    match format {
        Some(format) => NaiveDate::parse_from_str(text, format).ok().or_else(|| {
            NaiveDateTime::parse_from_str(text, format)
                .ok()
                .map(|time| time.date())
        }),
        None => text
            .get(..10)
            .and_then(|prefix| NaiveDate::parse_from_str(prefix, "%Y-%m-%d").ok()),
    }
}

fn rows_from_body(manifest: &Manifest, body: &[u8]) -> Result<Vec<Value>, SourceError> {
    match manifest.response.format.as_str() {
        "csv" => {
            let mut reader = csv::Reader::from_reader(body);
            let headers = reader
                .headers()
                .map_err(|error| SourceError::Parse(error.to_string()))?
                .clone();
            reader
                .records()
                .map(|record| {
                    let record = record.map_err(|error| SourceError::Parse(error.to_string()))?;
                    Ok(Value::Object(
                        headers
                            .iter()
                            .zip(record.iter())
                            .map(|(name, value)| {
                                (name.to_string(), Value::String(value.to_string()))
                            })
                            .collect(),
                    ))
                })
                .collect()
        }
        _ => {
            let value: Value = serde_json::from_slice(body)
                .map_err(|error| SourceError::Parse(error.to_string()))?;
            let rows = if manifest.response.rows.is_empty() {
                Some(&value)
            } else {
                value.pointer(&manifest.response.rows)
            };
            match rows {
                Some(Value::Array(rows)) => Ok(rows.clone()),
                _ => Err(SourceError::Parse(format!(
                    "response.rows \"{}\" did not point at an array",
                    manifest.response.rows
                ))),
            }
        }
    }
}

/// Maps a response body onto observations. Rows or values that are missing are skipped; a date that
/// is present but unreadable is an error, so a changed format shows up rather than vanishing.
pub fn extract(
    manifest: &Manifest,
    body: &[u8],
    fetched: DateTime<Utc>,
) -> Result<Vec<MetricObservation>, SourceError> {
    let rows = rows_from_body(manifest, body)?;
    let mut observations: BTreeMap<(String, NaiveDate), MetricObservation> = BTreeMap::new();
    let mut dated_rows = 0;
    for row in &rows {
        let Some(date_text) = row_field(row, &manifest.response.period.field) else {
            continue;
        };
        let period = parse_period(&date_text, manifest.response.period.format.as_deref())
            .ok_or_else(|| {
                SourceError::Parse(format!(
                    "could not read \"{date_text}\" in field {} as a date",
                    manifest.response.period.field
                ))
            })?;
        dated_rows += 1;
        let released_at = manifest.release.as_ref().map_or(fetched, |release| {
            scheduled_release(
                period,
                release.days_after_period,
                release.hour_utc,
                release.minute_utc,
                fetched,
            )
        });
        for series in &manifest.series {
            let Some(value) = row.get(&series.value).and_then(parse_value).or_else(|| {
                row_field(row, &series.value)
                    .as_deref()
                    .and_then(|text| parse_value(&Value::String(text.to_string())))
            }) else {
                continue;
            };
            let id = template::render(&series.id, fetched, &|name| row_field(row, name))
                .map_err(SourceError::Parse)?;
            observations.insert(
                (id.clone(), period),
                metric(
                    &id,
                    period,
                    released_at,
                    fetched,
                    value,
                    &series.unit,
                    &manifest.id,
                ),
            );
        }
    }
    if !rows.is_empty() && dated_rows == 0 {
        return Err(SourceError::Parse(format!(
            "no row had a field named {}",
            manifest.response.period.field
        )));
    }
    Ok(observations.into_values().collect())
}

#[async_trait::async_trait]
impl DataSource for PluginSource {
    fn id(&self) -> &str {
        &self.manifest.id
    }
    fn name(&self) -> &str {
        &self.manifest.name
    }
    fn cadence(&self) -> Cadence {
        if self.manifest.source.cadence == "daily" {
            Cadence::Daily
        } else {
            Cadence::Weekly
        }
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let secret = match &self.manifest.auth {
            Some(auth) => Some(read_secret(&self.manifest.id, &auth.secret)?),
            None => None,
        };
        let now = Utc::now();
        let (url, headers) = build_request(&self.manifest, now, secret.as_deref())?;
        let policy = HostPolicy::new(&self.manifest.permissions.hosts);
        let limits = Limits {
            max_bytes: self.manifest.max_bytes(),
            timeout: REQUEST_TIMEOUT,
        };
        let body = http::get(&policy, &limits, url, &headers).await?;
        Ok(extract(&self.manifest, &body, now)?
            .into_iter()
            .map(SourceRecord::Metric)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::manifest::load;

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    const CSV_PLUGIN: &str = r#"
id = "example-csv"
name = "Example CSV"
version = "1.0.0"
[permissions]
hosts = ["data.example.com"]
secrets = ["key"]
[source]
cadence = "weekly"
[request]
url = "https://data.example.com/{dataset}.csv?since={today-30d:%Y%m%d}"
vars = { dataset = "a&b=c/../d" }
[auth]
kind = "query"
name = "api_key"
secret = "key"
[response]
format = "csv"
[response.period]
field = "week"
format = "%m/%d/%Y"
[[series]]
id = "plugin.example-csv.{region:lower}.yield"
value = "yield"
unit = "bu/acre"
[release]
days_after_period = 1
hour_utc = 20
"#;

    #[test]
    fn url_values_cannot_inject_parameters_and_secrets_are_applied() {
        let manifest = load(CSV_PLUGIN, false).unwrap();
        let (url, headers) =
            build_request(&manifest, at("2026-10-24T12:00:00Z"), Some("s3cret")).unwrap();
        assert_eq!(url.host_str(), Some("data.example.com"));
        assert_eq!(url.path(), "/a%26b%3Dc%2F..%2Fd.csv");
        let pairs: Vec<_> = url
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("since".into(), "20260924".into()),
                ("api_key".into(), "s3cret".into())
            ]
        );
        assert!(headers.is_empty());
    }

    #[test]
    fn csv_rows_become_observations_with_scheduled_release_for_old_data() {
        let manifest = load(CSV_PLUGIN, false).unwrap();
        let body =
            "week,region,yield\n10/13/2026,IA,\"1,200.5\"\n10/20/2026,IA,1250\n10/20/2026,IL,\n";
        let fetched = at("2026-10-24T12:00:00Z");
        let rows = extract(&manifest, body.as_bytes(), fetched).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].series_id.0, "plugin.example-csv.ia.yield");
        assert_eq!(rows[0].value, 1200.5);
        assert_eq!(rows[0].period.to_string(), "2026-10-13");
        assert_eq!(rows[1].value, 1250.0);
        assert!(
            rows.iter()
                .all(|row| row.source_id.0 == "example-csv" && row.released_at <= row.fetched_at)
        );
    }

    #[test]
    fn an_unreadable_date_is_an_error_not_a_silent_gap() {
        let manifest = load(CSV_PLUGIN, false).unwrap();
        let error = extract(
            &manifest,
            b"week,region,yield\n2026-10-13,IA,5\n",
            at("2026-10-24T12:00:00Z"),
        )
        .unwrap_err();
        assert!(error.to_string().contains("could not read \"2026-10-13\""));
        let missing = extract(
            &manifest,
            b"day,region,yield\n10/13/2026,IA,5\n",
            at("2026-10-24T12:00:00Z"),
        )
        .unwrap_err();
        assert!(
            missing
                .to_string()
                .contains("no row had a field named week")
        );
    }

    #[test]
    fn json_rows_follow_the_pointer_and_dotted_fields() {
        let text = CSV_PLUGIN
            .replace(
                "format = \"csv\"",
                "format = \"json\"\nrows = \"/payload/items\"",
            )
            .replace(
                "field = \"week\"\nformat = \"%m/%d/%Y\"",
                "field = \"meta.date\"",
            )
            .replace("value = \"yield\"", "value = \"stats.yield\"");
        let manifest = load(&text, false).unwrap();
        let body = br#"{"payload":{"items":[{"meta":{"date":"2026-10-13T00:00:00"},"region":"KS","stats":{"yield":55}}]}}"#;
        let rows = extract(&manifest, body, at("2026-10-24T12:00:00Z")).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].series_id.0, "plugin.example-csv.ks.yield");
        let wrong = extract(
            &load(&text.replace("/payload/items", "/nothing"), false).unwrap(),
            body,
            at("2026-10-24T12:00:00Z"),
        )
        .unwrap_err();
        assert!(wrong.to_string().contains("did not point at an array"));
    }

    #[test]
    fn plugin_secrets_use_their_own_namespace() {
        assert_eq!(
            secret_account("example-csv", "key"),
            "plugin:example-csv:key"
        );
        assert_ne!(secret_account("example-csv", "key"), "massive");
    }
}
