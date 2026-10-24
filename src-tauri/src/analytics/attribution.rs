//! Ranks possible drivers for a flagged price move. Wording is deliberately probabilistic:
//! these are possible drivers, never proven causes.

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::alignment::market_close;
use super::moves::PriceMove;
use crate::core::{CalendarEvent, NewsItem};

pub const LABEL_LIKELY: &str = "Likely driver";
pub const LABEL_POSSIBLE: &str = "Possible driver";
pub const LABEL_LOW_CONFIDENCE: &str = "Possible driver, low confidence";
pub const LABEL_NONE: &str = "No clear driver found";

/// A news candidate must reach this score to be shown at all.
const NEWS_THRESHOLD: f64 = 0.55;
/// A single story at or above this score, with no close competitor, is a "possible driver".
const DOMINANT_SCORE: f64 = 0.7;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Driver {
    /// `scheduled_event` or `news`.
    pub kind: String,
    pub title: String,
    pub url: Option<String>,
    pub source: String,
    pub at: DateTime<Utc>,
    pub label: String,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveExplanation {
    #[serde(rename = "move")]
    pub price_move: PriceMove,
    /// Overall label: the best driver's label, or "No clear driver found".
    pub label: String,
    pub drivers: Vec<Driver>,
}

/// Events whose release time is only an expected window, not an exact timestamp.
fn is_exact(event: &CalendarEvent) -> bool {
    !event.title.to_lowercase().contains("expected window")
}

fn mentions(commodity: Option<&str>, symbol: &str) -> bool {
    commodity.is_none_or(|list| list.split(',').any(|item| item.trim() == symbol))
}

/// Stage one: scheduled releases that landed between the previous close and this close.
pub fn scheduled_event_drivers(
    price_move: &PriceMove,
    symbol: &str,
    events: &[CalendarEvent],
) -> Vec<Driver> {
    let (from, to) = (
        market_close(price_move.previous_date),
        market_close(price_move.date),
    );
    events
        .iter()
        .filter(|event| event.scheduled_at > from && event.scheduled_at <= to)
        .filter(|event| mentions(event.commodity.as_deref(), symbol))
        .map(|event| {
            let exact = is_exact(event);
            let mut reasons = vec![format!(
                "Timing: {} was scheduled between the previous close and this close.",
                event.kind
            )];
            reasons.push(if exact {
                "Release time is a fixed agency schedule.".into()
            } else {
                "Release date is an expected window, so this match is less certain.".into()
            });
            Driver {
                kind: "scheduled_event".into(),
                title: event.title.clone(),
                url: None,
                source: event.kind.clone(),
                at: event.scheduled_at,
                label: if exact { LABEL_LIKELY } else { LABEL_POSSIBLE }.into(),
                score: if exact { 1.0 } else { 0.75 },
                reasons,
            }
        })
        .collect()
}

const COMMODITY_TERMS: &[(&str, &[&str])] = &[
    ("ZC", &["corn", "maize", "ethanol"]),
    ("ZS", &["soy", "soybean", "crush", "soymeal"]),
    ("ZW", &["wheat"]),
];
const MARKET_TERMS: &[&str] = &[
    "futures", "price", "prices", "export", "exports", "crop", "harvest", "yield", "usda",
    "drought", "tariff", "demand", "supply", "stocks", "planting", "weather",
];
const BULLISH: &[&str] = &[
    "rally",
    "rallies",
    "surge",
    "rise",
    "rises",
    "higher",
    "drought",
    "cut",
    "shortfall",
    "strong demand",
    "record exports",
];
const BEARISH: &[&str] = &[
    "fall",
    "falls",
    "drop",
    "drops",
    "slump",
    "lower",
    "record crop",
    "bumper",
    "glut",
    "weak demand",
    "tumble",
];

fn source_quality(source: &str) -> (f64, &'static str) {
    let source = source.to_lowercase();
    if source.contains("usda.gov") || source.contains("cftc.gov") {
        (1.0, "official agency source")
    } else if ["reuters", "bloomberg", "wsj", "ap.org", "apnews"]
        .iter()
        .any(|name| source.contains(name))
    {
        (0.9, "major news wire")
    } else if [
        "agweb",
        "farmdoc",
        "dtnpf",
        "brownfield",
        "agriculture.com",
        "farmprogress",
    ]
    .iter()
    .any(|name| source.contains(name))
    {
        (0.7, "agricultural trade press")
    } else {
        (0.4, "unrecognized source")
    }
}

fn contains_any(text: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| text.contains(term))
}

/// Stage two: headlines near the move, scored on timing, relevance, source quality and direction fit.
pub fn news_drivers(price_move: &PriceMove, symbol: &str, news: &[NewsItem]) -> Vec<Driver> {
    let close = market_close(price_move.date);
    let window_start = market_close(price_move.previous_date);
    let terms = COMMODITY_TERMS
        .iter()
        .find(|(candidate, _)| *candidate == symbol)
        .map_or(&[][..], |(_, terms)| *terms);
    let mut scored: Vec<Driver> = news
        .iter()
        .filter(|item| item.published_at > window_start && item.published_at <= close)
        .filter_map(|item| {
            let title = item.title.to_lowercase();
            let commodity_hits = terms.iter().filter(|term| title.contains(**term)).count();
            if commodity_hits == 0 {
                return None;
            }
            let market_hits = MARKET_TERMS.iter().filter(|term| title.contains(**term)).count();
            let relevance = (0.5 + 0.25 * (commodity_hits.min(2) - 1) as f64 + 0.25 * (market_hits.min(1)) as f64).min(1.0);
            let hours_before = (close - item.published_at).num_minutes() as f64 / 60.0;
            let timing = if hours_before <= 18.0 { 1.0 } else { 0.6 };
            let (quality, quality_reason) = source_quality(&item.source);
            let bullish = contains_any(&title, BULLISH);
            let bearish = contains_any(&title, BEARISH);
            let (fit, fit_reason) = match (bullish, bearish, price_move.log_return > 0.0) {
                (true, false, true) | (false, true, false) => (1.0, "Direction: the headline wording matches the move."),
                (true, false, false) | (false, true, true) => (0.1, "Direction: the headline wording points the other way."),
                _ => (0.5, "Direction: the headline does not indicate a direction."),
            };
            // A headline pointing the other way is not offered as a possible driver at all.
            if fit < 0.5 {
                return None;
            }
            let score = 0.35 * timing + 0.30 * relevance + 0.15 * quality + 0.20 * fit;
            (score >= NEWS_THRESHOLD).then(|| Driver {
                kind: "news".into(),
                title: item.title.clone(),
                url: Some(item.url.clone()),
                source: item.source.clone(),
                at: item.published_at,
                label: LABEL_LOW_CONFIDENCE.into(),
                score,
                reasons: vec![
                    format!("Timing: published {:.0} hours before the close of the move.", hours_before.max(0.0)),
                    format!("Relevance: {commodity_hits} commodity term(s) and {market_hits} market term(s) in the headline."),
                    format!("Source: {quality_reason}."),
                    fit_reason.to_string(),
                ],
            })
        })
        .collect();
    scored.sort_by(|a, b| b.score.total_cmp(&a.score));
    // One clearly dominant story is a possible driver; several or weak candidates stay low confidence.
    if let Some(top) = scored.first().map(|driver| driver.score) {
        let runner_up = scored.get(1).map_or(0.0, |driver| driver.score);
        if top >= DOMINANT_SCORE && runner_up < top - 0.15 {
            scored[0].label = LABEL_POSSIBLE.into();
        }
    }
    scored
}

pub fn explain(
    price_move: &PriceMove,
    symbol: &str,
    events: &[CalendarEvent],
    news: &[NewsItem],
) -> MoveExplanation {
    let mut drivers = scheduled_event_drivers(price_move, symbol, events);
    drivers.extend(news_drivers(price_move, symbol, news));
    drivers.sort_by(|a, b| b.score.total_cmp(&a.score));
    let label = drivers
        .first()
        .map_or(LABEL_NONE.to_string(), |driver| driver.label.clone());
    MoveExplanation {
        price_move: price_move.clone(),
        label,
        drivers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }
    fn up_move() -> PriceMove {
        PriceMove {
            date: NaiveDate::from_ymd_opt(2026, 10, 16).unwrap(),
            previous_date: NaiveDate::from_ymd_opt(2026, 10, 15).unwrap(),
            log_return: 0.03,
            z_score: 3.1,
        }
    }
    fn event(title: &str, kind: &str, when: &str, commodity: Option<&str>) -> CalendarEvent {
        CalendarEvent {
            id: title.into(),
            kind: kind.into(),
            scheduled_at: at(when),
            commodity: commodity.map(str::to_string),
            title: title.into(),
        }
    }
    fn story(title: &str, source: &str, when: &str) -> NewsItem {
        NewsItem {
            title: title.into(),
            source: source.into(),
            published_at: at(when),
            url: format!("https://{source}/{title}"),
            commodity: "ZC".into(),
        }
    }

    #[test]
    fn an_exact_release_inside_the_window_is_a_likely_driver() {
        let events = [
            event(
                "USDA Export Sales · expected",
                "Export Sales",
                "2026-10-16T12:30:00Z",
                Some("ZC, ZS, ZW"),
            ),
            event(
                "USDA Export Sales · expected",
                "Export Sales",
                "2026-10-23T12:30:00Z",
                Some("ZC, ZS, ZW"),
            ),
        ];
        let drivers = scheduled_event_drivers(&up_move(), "ZC", &events);
        assert_eq!(drivers.len(), 1);
        assert_eq!(drivers[0].label, LABEL_LIKELY);
        assert!(drivers[0].reasons[0].contains("previous close"));
    }

    #[test]
    fn releases_for_other_commodities_and_expected_windows_are_not_overstated() {
        let events = [
            event(
                "Cattle on Feed",
                "Other",
                "2026-10-16T15:00:00Z",
                Some("LE"),
            ),
            event(
                "USDA WASDE · expected window",
                "WASDE",
                "2026-10-16T17:00:00Z",
                Some("ZC, ZS, ZW"),
            ),
        ];
        let drivers = scheduled_event_drivers(&up_move(), "ZC", &events);
        assert_eq!(drivers.len(), 1);
        assert_eq!(drivers[0].label, LABEL_POSSIBLE);
        assert!(
            drivers[0]
                .reasons
                .iter()
                .any(|reason| reason.contains("expected window"))
        );
    }

    #[test]
    fn one_dominant_headline_is_a_possible_driver_with_reasons() {
        let news = [story(
            "Corn futures rally as USDA cuts crop estimate",
            "reuters.com",
            "2026-10-16T14:00:00Z",
        )];
        let drivers = news_drivers(&up_move(), "ZC", &news);
        assert_eq!(drivers.len(), 1);
        assert_eq!(drivers[0].label, LABEL_POSSIBLE);
        assert_eq!(drivers[0].reasons.len(), 4);
        assert!(
            drivers[0]
                .reasons
                .iter()
                .any(|reason| reason.contains("matches the move"))
        );
    }

    #[test]
    fn competing_or_weak_headlines_stay_low_confidence() {
        let news = [
            story(
                "Corn futures rally as USDA cuts crop estimate",
                "reuters.com",
                "2026-10-16T14:00:00Z",
            ),
            story(
                "Corn prices rise on strong demand",
                "bloomberg.com",
                "2026-10-16T13:00:00Z",
            ),
        ];
        let drivers = news_drivers(&up_move(), "ZC", &news);
        assert_eq!(drivers.len(), 2);
        assert!(
            drivers
                .iter()
                .all(|driver| driver.label == LABEL_LOW_CONFIDENCE)
        );
    }

    #[test]
    fn headlines_outside_the_window_or_about_other_crops_are_ignored() {
        let news = [
            story("Corn futures rally", "reuters.com", "2026-10-14T10:00:00Z"),
            story("Wheat futures rally", "reuters.com", "2026-10-16T14:00:00Z"),
            story("Corn futures rally", "reuters.com", "2026-10-17T10:00:00Z"),
        ];
        assert!(news_drivers(&up_move(), "ZC", &news).is_empty());
    }

    #[test]
    fn headlines_pointing_the_other_way_are_not_offered() {
        let news = [story(
            "Corn prices tumble",
            "unknown.example",
            "2026-10-16T14:00:00Z",
        )];
        assert!(news_drivers(&up_move(), "ZC", &news).is_empty());
    }

    #[test]
    fn no_candidates_means_no_clear_driver() {
        let explanation = explain(&up_move(), "ZC", &[], &[]);
        assert_eq!(explanation.label, LABEL_NONE);
        assert!(explanation.drivers.is_empty());
    }

    #[test]
    fn scheduled_events_outrank_news() {
        let events = [event("CFTC COT", "COT", "2026-10-16T19:30:00Z", None)];
        let news = [story(
            "Corn futures rally as USDA cuts crop estimate",
            "reuters.com",
            "2026-10-16T14:00:00Z",
        )];
        let explanation = explain(&up_move(), "ZC", &events, &news);
        assert_eq!(explanation.label, LABEL_LIKELY);
        assert_eq!(explanation.drivers[0].kind, "scheduled_event");
        assert_eq!(explanation.drivers.len(), 2);
    }

    #[test]
    fn generated_wording_never_claims_causation() {
        let events = [event("CFTC COT", "COT", "2026-10-16T19:30:00Z", None)];
        let news = [story(
            "Corn futures rally as USDA cuts crop estimate",
            "reuters.com",
            "2026-10-16T14:00:00Z",
        )];
        let explanation = explain(&up_move(), "ZC", &events, &news);
        // Headlines are quoted from sources, so only labels and reasons are checked.
        for driver in &explanation.drivers {
            for text in driver.reasons.iter().chain([&driver.label]) {
                for banned in crate::analytics::backtest::BANNED_PHRASES {
                    assert!(!text.to_lowercase().contains(banned), "{text}");
                }
            }
        }
    }
}
