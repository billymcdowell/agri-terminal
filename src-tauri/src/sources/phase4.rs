use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, Utc};
use feed_rs::model::Feed;
use serde::Deserialize;
use serde_json::Value;

use crate::core::{NewsItem, WeatherForecast};

const NWS_BASE: &str = "https://api.weather.gov";
const OPEN_METEO_URL: &str = "https://api.open-meteo.com/v1/forecast";
const GDELT_URL: &str = "https://api.gdeltproject.org/api/v2/doc/doc";
const NWS_USER_AGENT: &str = "AgriTerminal/0.1 (open-source agricultural market research app)";

#[derive(Clone, Deserialize)]
pub struct CropRegionConfig {
    pub regions: Vec<CropRegion>,
    #[serde(default)]
    pub commodities: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub rss_feeds: Vec<RssFeedConfig>,
}

#[derive(Clone, Deserialize)]
pub struct CropRegion {
    pub id: String,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Clone, Deserialize)]
pub struct RssFeedConfig {
    pub name: String,
    pub url: String,
}

#[derive(Deserialize)]
struct NwsPointResponse {
    properties: NwsPointProperties,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NwsPointProperties {
    forecast_hourly: String,
}

pub async fn weather_for_commodity(
    commodity: &str,
    config: &CropRegionConfig,
) -> Result<Vec<WeatherForecast>, String> {
    let ids = config
        .commodities
        .get(&commodity.to_ascii_uppercase())
        .ok_or_else(|| format!("No configured growing regions for {commodity}"))?;
    let client = reqwest::Client::builder()
        .user_agent(NWS_USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Create weather client: {error}"))?;
    let mut forecasts = Vec::new();
    for id in ids {
        let region = config
            .regions
            .iter()
            .find(|region| &region.id == id)
            .ok_or_else(|| format!("Unknown configured crop region {id}"))?;
        let (nws, open_meteo) = tokio::join!(
            fetch_nws(&client, region),
            fetch_open_meteo(&client, region)
        );
        if let Ok(mut rows) = nws {
            forecasts.append(&mut rows);
        }
        if let Ok(mut rows) = open_meteo {
            forecasts.append(&mut rows);
        }
    }
    if forecasts.is_empty() {
        return Err("Weather providers returned no forecast data".into());
    }
    forecasts.sort_by_key(|forecast| forecast.valid_at);
    Ok(forecasts)
}

async fn fetch_nws(
    client: &reqwest::Client,
    region: &CropRegion,
) -> Result<Vec<WeatherForecast>, String> {
    let point_url = format!("{NWS_BASE}/points/{},{}", region.latitude, region.longitude);
    let point: NwsPointResponse = client
        .get(point_url)
        .header(reqwest::header::ACCEPT, "application/geo+json")
        .send()
        .await
        .map_err(|error| format!("NWS point lookup failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("NWS point lookup returned an error: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Parse NWS point lookup: {error}"))?;
    let value: Value = client
        .get(point.properties.forecast_hourly)
        .header(reqwest::header::ACCEPT, "application/geo+json")
        .send()
        .await
        .map_err(|error| format!("NWS forecast request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("NWS forecast returned an error: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Parse NWS forecast: {error}"))?;
    parse_nws_forecast(&value, region)
}

async fn fetch_open_meteo(
    client: &reqwest::Client,
    region: &CropRegion,
) -> Result<Vec<WeatherForecast>, String> {
    let value: Value = client
        .get(OPEN_METEO_URL)
        .query(&[
            ("latitude", region.latitude.to_string()),
            ("longitude", region.longitude.to_string()),
            (
                "hourly",
                "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m".into(),
            ),
            ("forecast_days", "3".into()),
            ("timezone", "UTC".into()),
        ])
        .send()
        .await
        .map_err(|error| format!("Open-Meteo request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Open-Meteo returned an error: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Parse Open-Meteo forecast: {error}"))?;
    parse_open_meteo(&value, region)
}

fn parse_nws_forecast(value: &Value, region: &CropRegion) -> Result<Vec<WeatherForecast>, String> {
    let periods = value
        .pointer("/properties/periods")
        .and_then(Value::as_array)
        .ok_or_else(|| "NWS response has no forecast periods".to_string())?;
    Ok(periods
        .iter()
        .filter_map(|period| {
            let start = period.get("startTime")?.as_str()?;
            let valid_at = DateTime::parse_from_rfc3339(start)
                .ok()?
                .with_timezone(&Utc);
            let temp_f = period.get("temperature")?.as_f64()?;
            let wind_mph = period
                .get("windSpeed")
                .and_then(Value::as_str)
                .and_then(first_number);
            let humidity = period
                .pointer("/relativeHumidity/value")
                .and_then(Value::as_f64);
            Some(WeatherForecast {
                region_id: region.id.clone(),
                region_name: region.name.clone(),
                latitude: region.latitude,
                longitude: region.longitude,
                provider: "NWS".into(),
                valid_at,
                temperature_c: Some((temp_f - 32.0) * 5.0 / 9.0),
                precipitation_mm: period
                    .pointer("/quantitativePrecipitation/value")
                    .and_then(Value::as_f64),
                precipitation_probability: period
                    .pointer("/probabilityOfPrecipitation/value")
                    .and_then(Value::as_f64),
                wind_kph: wind_mph.map(|speed| speed * 1.609_344),
                relative_humidity: humidity,
                summary: period
                    .get("shortForecast")
                    .and_then(Value::as_str)
                    .unwrap_or("Forecast")
                    .to_string(),
            })
        })
        .collect())
}

fn parse_open_meteo(value: &Value, region: &CropRegion) -> Result<Vec<WeatherForecast>, String> {
    let hourly = value
        .get("hourly")
        .ok_or_else(|| "Open-Meteo response has no hourly forecast".to_string())?;
    let times = hourly
        .get("time")
        .and_then(Value::as_array)
        .ok_or_else(|| "Open-Meteo response has no hourly timestamps".to_string())?;
    let values = [
        "temperature_2m",
        "relative_humidity_2m",
        "precipitation",
        "wind_speed_10m",
    ]
    .map(|field| hourly.get(field).and_then(Value::as_array));
    let mut forecasts = Vec::new();
    for (index, timestamp) in times.iter().enumerate().take(72) {
        let Some(timestamp) = timestamp.as_str() else {
            continue;
        };
        let parsed = DateTime::parse_from_rfc3339(timestamp)
            .map(|date| date.with_timezone(&Utc))
            .or_else(|_| {
                NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%dT%H:%M")
                    .map(|date| date.and_utc())
            })
            .map_err(|error| format!("Invalid Open-Meteo timestamp: {error}"))?;
        let at = |series: usize| {
            values[series]
                .and_then(|rows| rows.get(index))
                .and_then(Value::as_f64)
        };
        forecasts.push(WeatherForecast {
            region_id: region.id.clone(),
            region_name: region.name.clone(),
            latitude: region.latitude,
            longitude: region.longitude,
            provider: "Open-Meteo".into(),
            valid_at: parsed,
            temperature_c: at(0),
            relative_humidity: at(1),
            precipitation_mm: at(2),
            precipitation_probability: None,
            wind_kph: at(3),
            summary: "Model forecast".into(),
        });
    }
    Ok(forecasts)
}

#[derive(Deserialize)]
struct GdeltResponse {
    #[serde(default)]
    articles: Vec<GdeltArticle>,
}
#[derive(Deserialize)]
struct GdeltArticle {
    title: String,
    url: String,
    domain: Option<String>,
    seendate: String,
}

pub async fn news_for_commodity(
    commodity: &str,
    feeds: &[RssFeedConfig],
) -> Result<Vec<NewsItem>, String> {
    let symbols = match commodity.to_ascii_uppercase().as_str() {
        "ZC" | "CORN" => ("corn", "maize"),
        "ZS" | "SOYBEANS" => ("soybeans", "soybean"),
        "ZW" | "WHEAT" => ("wheat", "wheat"),
        other => return Err(format!("No news search terms configured for {other}")),
    };
    let client = reqwest::Client::builder()
        .user_agent(NWS_USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Create news client: {error}"))?;
    let query = format!("({} OR {}) sourcelang:English", symbols.0, symbols.1);
    let response = client
        .get(GDELT_URL)
        .query(&[
            ("query", query.as_str()),
            ("mode", "ArtList"),
            ("format", "json"),
            ("sort", "DateDesc"),
            ("maxrecords", "75"),
            ("timespan", "7d"),
        ])
        .send()
        .await;
    let response = match response {
        Ok(response) => match response.error_for_status() {
            Ok(response) => response.json::<GdeltResponse>().await.ok(),
            Err(_) => None,
        },
        Err(_) => None,
    };
    let mut results = response
        .map(|response| response.articles)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|article| {
            Some(NewsItem {
                title: article.title.trim().to_string(),
                source: article.domain.unwrap_or_else(|| "GDELT".into()),
                published_at: parse_gdelt_date(&article.seendate)?,
                url: article.url,
                commodity: commodity.to_ascii_uppercase(),
            })
        })
        .collect::<Vec<_>>();
    for feed in feeds {
        let Ok(response) = client.get(&feed.url).send().await else {
            continue;
        };
        let Ok(response) = response.error_for_status() else {
            continue;
        };
        let Ok(bytes) = response.bytes().await else {
            continue;
        };
        let Ok(feed_data) = feed_rs::parser::parse(bytes.as_ref()) else {
            continue;
        };
        results.extend(parse_feed(&feed_data, &feed.name, commodity));
    }
    Ok(dedupe_news(results))
}

fn parse_feed(feed: &Feed, source: &str, commodity: &str) -> Vec<NewsItem> {
    let terms: &[&str] = match commodity.to_ascii_uppercase().as_str() {
        "ZC" | "CORN" => &["corn", "maize"],
        "ZS" | "SOYBEANS" => &["soy", "soybean"],
        _ => &["wheat"],
    };
    feed.entries
        .iter()
        .filter_map(|entry| {
            let title = entry.title.as_ref()?.content.trim();
            if !terms.iter().any(|term| title.to_lowercase().contains(term)) {
                return None;
            }
            let url = entry.links.first()?.href.clone();
            let published_at = entry.published.or(entry.updated)?;
            Some(NewsItem {
                title: title.to_string(),
                source: source.to_string(),
                published_at: published_at.with_timezone(&Utc),
                url,
                commodity: commodity.to_ascii_uppercase(),
            })
        })
        .collect()
}

fn parse_gdelt_date(value: &str) -> Option<DateTime<Utc>> {
    // GDELT stamps UTC with a literal "Z", which chrono's offset-aware parsers do not accept.
    NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
        .ok()
        .map(|date| date.and_utc())
}

pub fn dedupe_news(items: Vec<NewsItem>) -> Vec<NewsItem> {
    let mut urls = HashSet::new();
    let mut titles = HashSet::new();
    let mut items = items
        .into_iter()
        .filter(|item| !item.title.is_empty() && item.url.starts_with("http"))
        .filter(|item| {
            let normalized = item
                .title
                .to_lowercase()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            urls.insert(item.url.to_lowercase()) && titles.insert(normalized)
        })
        .collect::<Vec<_>>();
    items.sort_by_key(|item| std::cmp::Reverse(item.published_at));
    items
}

fn first_number(value: &str) -> Option<f64> {
    value
        .split_whitespace()
        .find_map(|part| part.parse::<f64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nws_fixture_decodes_hourly_weather() {
        let config: CropRegionConfig = serde_json::from_str(include_str!(
            "../../../tests/fixtures/phase4_nws_synthetic.json"
        ))
        .unwrap();
        let region = &config.regions[0];
        let value: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/phase4_nws_synthetic.json"
        ))
        .unwrap();
        let forecast = parse_nws_forecast(&value["nws"], region).unwrap();
        assert_eq!(forecast.len(), 1);
        assert!((forecast[0].temperature_c.unwrap() - 20.0).abs() < 0.01);
        assert_eq!(forecast[0].summary, "Partly Sunny");
    }

    #[test]
    fn open_meteo_fixture_decodes_hourly_series() {
        let config: CropRegionConfig = serde_json::from_str(include_str!(
            "../../../tests/fixtures/phase4_open_meteo_synthetic.json"
        ))
        .unwrap();
        let value: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/phase4_open_meteo_synthetic.json"
        ))
        .unwrap();
        let forecast = parse_open_meteo(&value, &config.regions[0]).unwrap();
        assert_eq!(forecast.len(), 2);
        assert_eq!(forecast[1].temperature_c, Some(21.0));
        assert_eq!(forecast[0].precipitation_mm, Some(0.2));
    }

    #[test]
    fn gdelt_seendate_is_parsed_as_utc() {
        let parsed = parse_gdelt_date("20261024T121500Z").unwrap();
        assert_eq!(parsed.to_rfc3339(), "2026-10-24T12:15:00+00:00");
    }

    #[test]
    fn news_deduplicates_urls_and_normalized_titles() {
        let now = Utc::now();
        let item = |title: &str, url: &str| NewsItem {
            title: title.into(),
            source: "Fixture".into(),
            published_at: now,
            url: url.into(),
            commodity: "ZC".into(),
        };
        let deduped = dedupe_news(vec![
            item("Corn prices climb", "https://news.example/a"),
            item("  corn   prices CLIMB ", "https://news.example/b"),
            item("Another corn report", "https://news.example/a"),
        ]);
        assert_eq!(deduped.len(), 1);
    }

    #[test]
    fn rss_headlines_are_tagged_by_commodity_terms() {
        let feed = feed_rs::parser::parse(
            include_bytes!("../../../tests/fixtures/phase4_news_synthetic.xml").as_slice(),
        )
        .unwrap();
        let parsed = parse_feed(&feed, "Synthetic RSS", "ZC");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].commodity, "ZC");
        assert!(parsed[0].title.contains("corn"));
    }
}
