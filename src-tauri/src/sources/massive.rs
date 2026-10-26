//! Daily CBOT grain futures bars from Massive (formerly Polygon.io), using the user's own key.
//!
//! Massive has no continuous contract, so each refresh asks for the nearest contracts of each
//! root and keeps, for every session, the bar of whichever contract traded the most.

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, de::DeserializeOwned};

use crate::{
    core::{Cadence, DataSource, Observation, SeriesId, SourceError, SourceId, SourceRecord, Unit},
    sources::fundamentals::{http_client, http_error, parse_error, request_error, secret},
};

const BASE_URL: &str = "https://api.massive.com";
/// Keychain account for the key; the generic `save_secret` command writes it under the source id.
pub const SECRET_ID: &str = "massive";
/// CBOT grain roots whose front-month series are built.
const ROOTS: [&str; 3] = ["ZC", "ZS", "ZW"];
/// Days of sessions requested on each refresh.
const WINDOW_DAYS: i64 = 30;
/// Grains roll a few weeks before expiry, so the most traded contract is always the nearest one
/// or the one after it.
const CANDIDATES_PER_ROOT: usize = 2;
/// The free plan allows five calls a minute and a refresh makes seven, so a refresh waits for the
/// limit to reset instead of failing. A longer wait than this is reported as rate limited.
const MAX_RATE_LIMIT_WAIT_SECONDS: u64 = 65;
const MAX_RATE_LIMIT_RETRIES: u32 = 3;

pub struct MassiveSource;

#[async_trait::async_trait]
impl DataSource for MassiveSource {
    fn id(&self) -> &str {
        "massive"
    }
    fn name(&self) -> &str {
        "Massive · CBOT futures"
    }
    fn cadence(&self) -> Cadence {
        Cadence::Daily
    }
    async fn fetch(&self) -> Result<Vec<SourceRecord>, SourceError> {
        let client = Client::new(BASE_URL, secret(SECRET_ID)?)?;
        fetch_front_months(&client, Utc::now()).await
    }
}

async fn fetch_front_months(
    client: &Client,
    now: DateTime<Utc>,
) -> Result<Vec<SourceRecord>, SourceError> {
    let start = (now - chrono::Duration::days(WINDOW_DAYS)).date_naive();
    let contracts = client.contracts(start).await?;
    let mut records = Vec::new();
    for root in ROOTS {
        let tickers = candidate_tickers(&contracts, root);
        if tickers.is_empty() {
            return Err(SourceError::Parse(format!(
                "Massive listed no {root} contracts trading on {start}"
            )));
        }
        let mut bars = Vec::new();
        for ticker in &tickers {
            bars.extend(client.session_bars(ticker, start).await?);
        }
        records.extend(
            front_month(root, &bars, Utc::now())
                .into_iter()
                .map(SourceRecord::Price),
        );
    }
    Ok(records)
}

#[derive(Deserialize)]
struct Page<T> {
    #[serde(default = "Vec::new")]
    results: Vec<T>,
}

#[derive(Deserialize)]
struct Contract {
    ticker: String,
    product_code: String,
    last_trade_date: NaiveDate,
}

#[derive(Deserialize)]
struct SessionBar {
    session_end_date: NaiveDate,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
    /// Missing until the session settles.
    settlement_price: Option<f64>,
}

struct Client {
    http: reqwest::Client,
    base: String,
    key: String,
}

impl Client {
    fn new(base: &str, key: String) -> Result<Self, SourceError> {
        Ok(Self {
            http: http_client()?,
            base: base.into(),
            key,
        })
    }

    /// Single (not spread) contracts of every root that were trading on `date`.
    async fn contracts(&self, date: NaiveDate) -> Result<Vec<Contract>, SourceError> {
        let roots = ROOTS.join(",");
        let date = date.to_string();
        let page: Page<Contract> = self
            .get(
                "/futures/v1/contracts",
                &[
                    ("product_code.any_of", roots.as_str()),
                    ("date", date.as_str()),
                    ("active", "true"),
                    ("type", "single"),
                    ("limit", "1000"),
                ],
            )
            .await?;
        Ok(page.results)
    }

    async fn session_bars(
        &self,
        ticker: &str,
        start: NaiveDate,
    ) -> Result<Vec<SessionBar>, SourceError> {
        let start = start.to_string();
        let page: Page<SessionBar> = self
            .get(
                &format!("/futures/v1/aggs/{ticker}"),
                &[
                    ("resolution", "1session"),
                    ("window_start.gte", start.as_str()),
                    ("sort", "window_start.asc"),
                    ("limit", "1000"),
                ],
            )
            .await?;
        Ok(page.results)
    }

    /// Sends the key as a bearer token so it never appears in a URL, and waits out the
    /// per-minute limit.
    async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T, SourceError> {
        let mut retries = 0;
        loop {
            let response = self
                .http
                .get(format!("{}{path}", self.base))
                .bearer_auth(&self.key)
                .query(query)
                .send()
                .await
                .map_err(|error| request_error("Massive", error))?;
            if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                let wait = rate_limit_wait(response.headers());
                if retries < MAX_RATE_LIMIT_RETRIES && wait <= MAX_RATE_LIMIT_WAIT_SECONDS {
                    retries += 1;
                    tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                    continue;
                }
                return Err(SourceError::RateLimited {
                    retry_after: i64::try_from(wait)
                        .ok()
                        .map(|seconds| Utc::now() + chrono::Duration::seconds(seconds)),
                });
            }
            if !response.status().is_success() {
                return Err(http_error(&response));
            }
            return response.json().await.map_err(parse_error);
        }
    }
}

/// Seconds until the rate limit resets. Massive sends `x-ratelimit-reset` rather than the standard
/// `Retry-After`, which is still read first in case that changes.
fn rate_limit_wait(headers: &reqwest::header::HeaderMap) -> u64 {
    [reqwest::header::RETRY_AFTER.as_str(), "x-ratelimit-reset"]
        .into_iter()
        .find_map(|name| headers.get(name)?.to_str().ok()?.trim().parse().ok())
        .unwrap_or(60)
}

/// The nearest contracts of a root, nearest expiry first.
fn candidate_tickers(contracts: &[Contract], root: &str) -> Vec<String> {
    let mut nearest: Vec<_> = contracts
        .iter()
        .filter(|contract| contract.product_code == root)
        .collect();
    nearest.sort_by_key(|contract| contract.last_trade_date);
    nearest
        .into_iter()
        .take(CANDIDATES_PER_ROOT)
        .map(|contract| contract.ticker.clone())
        .collect()
}

/// One bar per settled session, from whichever contract traded the most that session. A session
/// still in progress has no settlement price and is left out until a later refresh.
fn front_month(root: &str, bars: &[SessionBar], fetched_at: DateTime<Utc>) -> Vec<Observation> {
    let mut busiest: BTreeMap<NaiveDate, &SessionBar> = BTreeMap::new();
    for bar in bars.iter().filter(|bar| bar.settlement_price.is_some()) {
        busiest
            .entry(bar.session_end_date)
            .and_modify(|current| {
                if bar.volume > current.volume {
                    *current = bar;
                }
            })
            .or_insert(bar);
    }
    busiest
        .into_values()
        .map(|bar| Observation {
            series_id: SeriesId::from(format!("price.{root}.close")),
            period: bar.session_end_date,
            // Massive doesn't say when a bar was first published; use fetch time as a conservative as-of boundary.
            released_at: fetched_at,
            // CBOT grains are quoted in cents per bushel; normalize to USD/bushel.
            open: bar.open / 100.0,
            high: bar.high / 100.0,
            low: bar.low / 100.0,
            close: bar.close / 100.0,
            unit: Unit::UsdPerBushel,
            source_id: SourceId::from("massive"),
            fetched_at,
            revision: 0,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const CONTRACTS: &str =
        include_str!("../../../tests/fixtures/massive_contracts_synthetic.json");
    const ZSX6_BARS: &str =
        include_str!("../../../tests/fixtures/massive_aggs_ZSX6_synthetic.json");
    const ZSF7_BARS: &str =
        include_str!("../../../tests/fixtures/massive_aggs_ZSF7_synthetic.json");

    fn bars(json: &str) -> Vec<SessionBar> {
        serde_json::from_str::<Page<SessionBar>>(json)
            .unwrap()
            .results
    }

    #[test]
    fn candidates_are_the_two_nearest_contracts_of_the_root() {
        let contracts = serde_json::from_str::<Page<Contract>>(CONTRACTS)
            .unwrap()
            .results;
        assert_eq!(candidate_tickers(&contracts, "ZS"), ["ZSX6", "ZSF7"]);
        assert_eq!(candidate_tickers(&contracts, "ZC"), ["ZCZ6"]);
        assert!(candidate_tickers(&contracts, "ZW").is_empty());
    }

    #[test]
    fn front_month_follows_volume_and_skips_unsettled_sessions() {
        let fetched_at = DateTime::parse_from_rfc3339("2026-10-26T17:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut all = bars(ZSX6_BARS);
        all.extend(bars(ZSF7_BARS));
        let series = front_month("ZS", &all, fetched_at);
        let closes: Vec<_> = series
            .iter()
            .map(|bar| (bar.period.to_string(), bar.close))
            .collect();
        // November leads until the 23rd, when January trades more; the 26th has not settled.
        assert_eq!(
            closes,
            [
                ("2026-10-21".to_string(), 10.0),
                ("2026-10-22".to_string(), 10.1),
                ("2026-10-23".to_string(), 10.325),
            ]
        );
        let last = series.last().unwrap();
        assert_eq!((last.open, last.high, last.low), (10.225, 10.375, 10.175));
        assert_eq!(last.series_id.0, "price.ZS.close");
        assert_eq!(last.source_id.0, "massive");
        assert_eq!(last.released_at, fetched_at);
    }

    #[test]
    fn rate_limit_wait_reads_massive_and_standard_headers() {
        let mut headers = reqwest::header::HeaderMap::new();
        assert_eq!(rate_limit_wait(&headers), 60);
        headers.insert("x-ratelimit-reset", "49".parse().unwrap());
        assert_eq!(rate_limit_wait(&headers), 49);
        headers.insert(reqwest::header::RETRY_AFTER, "5".parse().unwrap());
        assert_eq!(rate_limit_wait(&headers), 5);
    }

    #[tokio::test]
    async fn waits_out_the_rate_limit_and_sends_the_key_as_a_bearer_token() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let responses = [
                "HTTP/1.1 429 Too Many Requests\r\nx-ratelimit-reset: 0\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string(),
                format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{ZSX6_BARS}",
                    ZSX6_BARS.len()
                ),
            ];
            let mut requests = Vec::new();
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = [0u8; 4096];
                let read = socket.read(&mut buffer).await.unwrap();
                requests.push(String::from_utf8_lossy(&buffer[..read]).to_string());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        let client = Client::new(&base, "TEST-KEY".into()).unwrap();
        let start = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert_eq!(client.session_bars("ZSX6", start).await.unwrap().len(), 4);
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        for request in &requests {
            let request_line = request.lines().next().unwrap();
            assert!(
                request_line.starts_with("GET /futures/v1/aggs/ZSX6?"),
                "{request_line}"
            );
            assert!(!request_line.contains("TEST-KEY"), "{request_line}");
            assert!(
                request
                    .to_ascii_lowercase()
                    .contains("authorization: bearer test-key"),
                "{request}"
            );
        }
    }

    #[test]
    #[ignore = "live Massive contract check requires a key in MASSIVE_API_KEY or the keychain"]
    fn live_massive_contract() {
        let Some(key) = std::env::var("MASSIVE_API_KEY")
            .ok()
            .or_else(|| secret(SECRET_ID).ok())
        else {
            return;
        };
        let client = Client::new(BASE_URL, key).unwrap();
        let records =
            tauri::async_runtime::block_on(fetch_front_months(&client, Utc::now())).unwrap();
        for root in ROOTS {
            let series_id = format!("price.{root}.close");
            let series: Vec<_> = records
                .iter()
                .filter_map(|record| match record {
                    SourceRecord::Price(bar) if bar.series_id.0 == series_id => Some(bar),
                    _ => None,
                })
                .collect();
            assert!(series.len() >= 15, "{root}: only {} sessions", series.len());
            assert!(
                series
                    .windows(2)
                    .all(|pair| pair[0].period < pair[1].period)
            );
            assert!(
                series.iter().all(|bar| (1.0..50.0).contains(&bar.close)
                    && bar.low <= bar.close
                    && bar.close <= bar.high),
                "{root}: a bar is outside USD/bushel range or its own high and low"
            );
        }
    }
}
