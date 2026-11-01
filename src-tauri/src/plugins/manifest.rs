use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::template;

/// Ids that belong to built-in sources; no plugin may take them over.
pub const RESERVED_IDS: &[&str] = &[
    "massive",
    // The retired price source. Bars stored under it are still shown as market data.
    "databento",
    "fixture-corn",
    "cftc-cot",
    "usda-nass",
    "usda-fas",
    "us-drought-monitor",
    "crop-nowcast-yield",
    "crop-nowcast-acreage",
    "crop-nowcast-brief",
];
pub const DEFAULT_MAX_BYTES: usize = 5 * 1024 * 1024;
pub const HARD_MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_SERIES: usize = 50;
const MAX_MANIFEST_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license_note: String,
    pub permissions: Permissions,
    pub source: SourceSpec,
    pub request: RequestSpec,
    #[serde(default)]
    pub auth: Option<AuthSpec>,
    pub response: ResponseSpec,
    pub series: Vec<SeriesSpec>,
    #[serde(default)]
    pub release: Option<ReleaseSpec>,
}

/// What the plugin may touch. Anything not listed here is refused at request time.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Permissions {
    /// Hosts the plugin may contact: exact names, or `*.example.com` for subdomains.
    pub hosts: Vec<String>,
    /// Secret names the plugin may read from the keychain, scoped to this plugin.
    #[serde(default)]
    pub secrets: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceSpec {
    /// `daily` or `weekly`.
    pub cadence: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RequestSpec {
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// Values for `{name}` placeholders in the URL.
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
    /// Largest response accepted; defaults to 5 MiB, at most 20 MiB.
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuthSpec {
    /// `header` or `query`.
    pub kind: String,
    /// Header or query parameter name.
    pub name: String,
    /// One of `permissions.secrets`.
    pub secret: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseSpec {
    /// `json` or `csv`.
    pub format: String,
    /// JSON pointer to the array of rows, such as `/data`. Empty means the root array. Ignored for CSV.
    #[serde(default)]
    pub rows: String,
    pub period: PeriodSpec,
    /// A row field holding the time the row became public, for sources that publish it.
    #[serde(default)]
    pub released_at: Option<ReleasedAtSpec>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReleasedAtSpec {
    /// An RFC 3339 time such as `2026-08-18T18:00:00Z`.
    pub field: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PeriodSpec {
    pub field: String,
    /// A chrono format such as `%m/%d/%Y`. Without one, the first ten characters are read as `YYYY-MM-DD`.
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeriesSpec {
    /// Series id; may use row fields such as `{stateAbbreviation:lower}`.
    pub id: String,
    /// Row field holding the value.
    pub value: String,
    pub unit: String,
}

/// When rows are treated as public relative to their period, for as-of joins.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseSpec {
    pub days_after_period: i64,
    pub hour_utc: u32,
    #[serde(default)]
    pub minute_utc: u32,
}

impl Manifest {
    pub fn max_bytes(&self) -> usize {
        self.request.max_bytes.unwrap_or(DEFAULT_MAX_BYTES)
    }
}

/// Parses and validates a manifest. `trusted` manifests ship with the app and may write any
/// series id; installed plugins must keep to `plugin.<id>.` so they cannot overwrite real data.
/// Every problem is reported at once, each naming the field to change.
pub fn load(text: &str, trusted: bool) -> Result<Manifest, Vec<String>> {
    if text.len() > MAX_MANIFEST_BYTES {
        return Err(vec![format!(
            "manifest: larger than the {MAX_MANIFEST_BYTES} byte limit"
        )]);
    }
    let manifest: Manifest =
        toml::from_str(text).map_err(|error| vec![format!("manifest: {}", error.message())])?;
    let problems = validate(&manifest, trusted);
    if problems.is_empty() {
        Ok(manifest)
    } else {
        Err(problems)
    }
}

fn valid_host_pattern(host: &str) -> bool {
    let name = host.strip_prefix("*.").unwrap_or(host);
    !name.is_empty()
        && name.contains('.')
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
        && name.parse::<std::net::IpAddr>().is_err()
}

pub fn validate(manifest: &Manifest, trusted: bool) -> Vec<String> {
    let mut problems = Vec::new();
    let mut bad = |field: &str, message: String| problems.push(format!("{field}: {message}"));

    let id_ok = manifest.id.len() >= 3
        && manifest.id.len() <= 40
        && manifest.id.starts_with(|c: char| c.is_ascii_lowercase())
        && manifest
            .id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !id_ok {
        bad(
            "id",
            format!(
                "\"{}\" must be 3-40 characters: lowercase letters, digits and '-', starting with a letter",
                manifest.id
            ),
        );
    }
    if !trusted && RESERVED_IDS.contains(&manifest.id.as_str()) {
        bad(
            "id",
            format!(
                "\"{}\" belongs to a built-in source; choose another id",
                manifest.id
            ),
        );
    }
    if manifest.name.trim().is_empty() {
        bad("name", "must not be empty".into());
    }
    let version_ok = manifest.version.split('.').count() == 3
        && manifest
            .version
            .split('.')
            .all(|part| part.parse::<u32>().is_ok());
    if !version_ok {
        bad(
            "version",
            format!("\"{}\" must look like 1.2.3", manifest.version),
        );
    }

    if manifest.permissions.hosts.is_empty() {
        bad(
            "permissions.hosts",
            "list at least one host the plugin may contact".into(),
        );
    }
    for host in &manifest.permissions.hosts {
        if !valid_host_pattern(host) {
            bad(
                "permissions.hosts",
                format!(
                    "\"{host}\" must be a lowercase host name such as api.example.com or *.example.com, with no scheme, path or IP address"
                ),
            );
        }
    }
    for secret in &manifest.permissions.secrets {
        if secret.is_empty()
            || !secret
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            bad(
                "permissions.secrets",
                format!("\"{secret}\" may contain only letters, digits, '-' and '_'"),
            );
        }
    }

    if !["daily", "weekly"].contains(&manifest.source.cadence.as_str()) {
        bad(
            "source.cadence",
            format!("\"{}\" must be daily or weekly", manifest.source.cadence),
        );
    }

    // The request URL: https, a fixed host that the permissions cover, and defined placeholders.
    let url = &manifest.request.url;
    match url.strip_prefix("https://") {
        None => bad(
            "request.url",
            format!("must start with https:// (found \"{url}\")"),
        ),
        Some(after) => {
            let authority = after.split(['/', '?', '#']).next().unwrap_or("");
            if authority.contains('{') {
                bad("request.url", "the host cannot contain placeholders".into());
            } else if authority.contains('@') {
                bad(
                    "request.url",
                    "must not contain credentials; use [auth] and a secret".into(),
                );
            } else {
                let host = authority.split(':').next().unwrap_or("").to_lowercase();
                if authority.contains(':') {
                    bad("request.url", "custom ports are not allowed".into());
                }
                if !host_is_listed(&host, &manifest.permissions.hosts) {
                    bad(
                        "request.url",
                        format!("host \"{host}\" is not listed in permissions.hosts"),
                    );
                }
            }
        }
    }
    for name in template::placeholders(url) {
        if !template::is_date_expression(&name) && !manifest.request.vars.contains_key(&name) {
            bad(
                "request.url",
                format!("{{{name}}} is not defined in [request.vars]"),
            );
        }
    }
    for name in manifest.request.headers.keys() {
        if [
            "host",
            "cookie",
            "authorization",
            "content-length",
            "transfer-encoding",
        ]
        .contains(&name.to_lowercase().as_str())
        {
            bad(
                "request.headers",
                format!("\"{name}\" cannot be set by a plugin; use [auth] for credentials"),
            );
        }
    }
    if let Some(max) = manifest.request.max_bytes
        && (max == 0 || max > HARD_MAX_BYTES)
    {
        bad(
            "request.max_bytes",
            format!("must be between 1 and {HARD_MAX_BYTES}"),
        );
    }

    if let Some(auth) = &manifest.auth {
        if !["header", "query"].contains(&auth.kind.as_str()) {
            bad(
                "auth.kind",
                format!("\"{}\" must be header or query", auth.kind),
            );
        }
        if auth.name.trim().is_empty() {
            bad("auth.name", "must not be empty".into());
        }
        if !manifest.permissions.secrets.contains(&auth.secret) {
            bad(
                "auth.secret",
                format!(
                    "\"{}\" must also be listed in permissions.secrets",
                    auth.secret
                ),
            );
        }
    }

    if !["json", "csv"].contains(&manifest.response.format.as_str()) {
        bad(
            "response.format",
            format!("\"{}\" must be json or csv", manifest.response.format),
        );
    }
    if manifest.response.period.field.trim().is_empty() {
        bad(
            "response.period.field",
            "must name the row field holding the date".into(),
        );
    }
    if let Some(released_at) = &manifest.response.released_at {
        if released_at.field.trim().is_empty() {
            bad(
                "response.released_at.field",
                "must name the row field holding the release time".into(),
            );
        }
        if manifest.release.is_some() {
            bad(
                "release",
                "use either [release] or [response.released_at], not both".into(),
            );
        }
    }

    if manifest.series.is_empty() {
        bad("series", "define at least one [[series]]".into());
    }
    if manifest.series.len() > MAX_SERIES {
        bad("series", format!("at most {MAX_SERIES} series per plugin"));
    }
    let required_prefix = format!("plugin.{}.", manifest.id);
    for (index, series) in manifest.series.iter().enumerate() {
        let field = format!("series[{index}]");
        if series.id.trim().is_empty()
            || series.value.trim().is_empty()
            || series.unit.trim().is_empty()
        {
            bad(&field, "id, value and unit must all be set".into());
        }
        if !trusted && !series.id.starts_with(&required_prefix) {
            bad(
                &format!("{field}.id"),
                format!(
                    "\"{}\" must start with \"{required_prefix}\" so plugins cannot overwrite built-in series",
                    series.id
                ),
            );
        }
    }

    if let Some(release) = &manifest.release
        && (release.hour_utc > 23
            || release.minute_utc > 59
            || !(0..=31).contains(&release.days_after_period))
    {
        bad(
            "release",
            "days_after_period must be 0-31, hour_utc 0-23 and minute_utc 0-59".into(),
        );
    }
    problems
}

pub fn host_is_listed(host: &str, allowed: &[String]) -> bool {
    allowed
        .iter()
        .any(|pattern| match pattern.strip_prefix("*.") {
            Some(suffix) => host.len() > suffix.len() + 1 && host.ends_with(&format!(".{suffix}")),
            None => host == pattern,
        })
}

#[cfg(test)]
pub mod tests_support {
    pub const GOOD_MANIFEST: &str = super::tests::GOOD;
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub const GOOD: &str = r#"
id = "example-weather"
name = "Example weather"
version = "1.0.0"

[permissions]
hosts = ["api.example.com"]
secrets = ["token"]

[source]
cadence = "daily"

[request]
url = "https://api.example.com/v1/{place}?from={today-7d}"
vars = { place = "ames" }

[auth]
kind = "header"
name = "X-Api-Key"
secret = "token"

[response]
format = "json"
rows = "/data"
[response.period]
field = "date"

[[series]]
id = "plugin.example-weather.temp"
value = "temp"
unit = "celsius"
"#;

    #[test]
    fn a_valid_manifest_loads() {
        let manifest = load(GOOD, false).unwrap();
        assert_eq!(manifest.id, "example-weather");
        assert_eq!(manifest.max_bytes(), DEFAULT_MAX_BYTES);
    }

    #[test]
    fn every_problem_is_reported_with_its_field() {
        let bad = GOOD
            .replace("id = \"example-weather\"", "id = \"databento\"")
            .replace("version = \"1.0.0\"", "version = \"one\"")
            .replace(
                "https://api.example.com/v1/{place}?from={today-7d}",
                "http://evil.example.net/{missing}",
            )
            .replace(
                "secret = \"token\"\n\n[response]",
                "secret = \"other\"\n\n[response]",
            )
            .replace("plugin.example-weather.temp", "price.ZC.close");
        let problems = load(&bad, false).unwrap_err();
        let text = problems.join("\n");
        for expected in [
            "id: \"databento\" belongs to a built-in source",
            "version: \"one\" must look like 1.2.3",
            "request.url: must start with https://",
            "auth.secret: \"other\" must also be listed in permissions.secrets",
            "series[0].id: \"price.ZC.close\" must start with \"plugin.databento.\"",
        ] {
            assert!(text.contains(expected), "missing {expected:?} in\n{text}");
        }
    }

    #[test]
    fn urls_must_stay_on_listed_hosts() {
        for (url, message) in [
            (
                "https://other.example.org/x",
                "is not listed in permissions.hosts",
            ),
            (
                "https://api.example.com@evil.example.net/x",
                "must not contain credentials",
            ),
            ("https://api.example.com:8443/x", "custom ports"),
            (
                "https://{place}.example.com/x",
                "host cannot contain placeholders",
            ),
            ("https://api.example.com/{nope}", "{nope} is not defined"),
        ] {
            let text = GOOD.replace("https://api.example.com/v1/{place}?from={today-7d}", url);
            let problems = load(&text, false).unwrap_err().join("\n");
            assert!(problems.contains(message), "{url}: {problems}");
        }
    }

    #[test]
    fn host_patterns_reject_ips_schemes_and_paths() {
        for host in [
            "127.0.0.1",
            "https://api.example.com",
            "api.example.com/x",
            "localhost",
            "API.example.com",
            "*.com.",
            "*.",
        ] {
            let text = GOOD.replace(
                "hosts = [\"api.example.com\"]",
                &format!("hosts = [\"{host}\"]"),
            );
            assert!(
                load(&text, false)
                    .unwrap_err()
                    .join("\n")
                    .contains("permissions.hosts"),
                "{host}"
            );
        }
    }

    #[test]
    fn wildcard_hosts_match_subdomains_only() {
        let allowed = vec!["*.example.com".to_string(), "exact.org".to_string()];
        assert!(host_is_listed("api.example.com", &allowed));
        assert!(host_is_listed("a.b.example.com", &allowed));
        assert!(!host_is_listed("example.com", &allowed));
        assert!(!host_is_listed("evilexample.com", &allowed));
        assert!(host_is_listed("exact.org", &allowed));
        assert!(!host_is_listed("sub.exact.org", &allowed));
    }

    #[test]
    fn unknown_fields_and_syntax_errors_are_explained() {
        let unknown = GOOD.replace("[source]", "[source]\nrun = \"rm -rf /\"");
        assert!(load(&unknown, false).unwrap_err()[0].contains("unknown field `run`"));
        assert!(load("id = ", false).unwrap_err()[0].starts_with("manifest:"));
    }

    #[test]
    fn trusted_manifests_may_use_any_series_id_and_reserved_ids() {
        let text = GOOD
            .replace("id = \"example-weather\"", "id = \"us-drought-monitor\"")
            .replace("plugin.example-weather.temp", "drought.ia.D0");
        assert!(load(&text, true).is_ok());
        assert!(load(&text, false).is_err());
    }

    #[test]
    fn ids_cannot_traverse_paths_and_huge_manifests_are_refused() {
        for id in ["../escape", "a/b", "UPPER", "x"] {
            let text = GOOD.replace("id = \"example-weather\"", &format!("id = \"{id}\""));
            assert!(
                load(&text, false).unwrap_err().join("\n").contains("id:"),
                "{id}"
            );
        }
        let huge = format!("{GOOD}\n# {}", "x".repeat(70_000));
        assert!(load(&huge, false).unwrap_err()[0].contains("byte limit"));
    }

    #[test]
    fn size_limit_is_bounded() {
        let text = GOOD.replace(
            "vars = { place = \"ames\" }",
            "vars = { place = \"ames\" }\nmax_bytes = 99999999",
        );
        assert!(
            load(&text, false)
                .unwrap_err()
                .join("\n")
                .contains("request.max_bytes")
        );
    }

    #[test]
    fn a_release_time_field_replaces_the_release_schedule() {
        let with_field = GOOD.replace(
            "field = \"date\"",
            "field = \"date\"\n[response.released_at]\nfield = \"published_at\"",
        );
        let manifest = load(&with_field, false).unwrap();
        assert_eq!(manifest.response.released_at.unwrap().field, "published_at");
        let both = format!("{with_field}\n[release]\ndays_after_period = 1\nhour_utc = 20\n");
        assert!(
            load(&both, false).unwrap_err().contains(
                &"release: use either [release] or [response.released_at], not both".into()
            )
        );
        let empty = with_field.replace("field = \"published_at\"", "field = \" \"");
        assert!(load(&empty, false).unwrap_err()[0].starts_with("response.released_at.field:"));
    }
}
