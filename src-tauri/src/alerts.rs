//! Price alerts. An alert fires once when the latest close crosses its threshold and re-arms when
//! the price moves back, so a price hovering around the line does not notify on every update.

use std::collections::HashMap;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Above,
    Below,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceAlert {
    pub id: String,
    pub symbol: String,
    pub direction: Direction,
    pub threshold: f64,
}

/// An alert with its stored state.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRecord {
    #[serde(flatten)]
    pub alert: PriceAlert,
    pub enabled: bool,
    /// True from the moment it fires until the price moves back across the threshold.
    pub triggered: bool,
}

/// The crossing that fired an alert. Prices are in USD per bushel; the app words the notification in
/// the user's display unit.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertFired {
    #[serde(flatten)]
    pub alert: PriceAlert,
    pub close: f64,
    pub date: NaiveDate,
}

pub fn validate(alert: &PriceAlert) -> Result<(), String> {
    if alert.id.trim().is_empty() {
        return Err("Alert needs an id".into());
    }
    if !["ZC", "ZS", "ZW"].contains(&alert.symbol.as_str()) {
        return Err(format!("Unknown commodity {}", alert.symbol));
    }
    if !alert.threshold.is_finite() || alert.threshold <= 0.0 {
        return Err("Threshold must be a positive price".into());
    }
    Ok(())
}

fn is_met(alert: &PriceAlert, close: f64) -> bool {
    match alert.direction {
        Direction::Above => close >= alert.threshold,
        Direction::Below => close <= alert.threshold,
    }
}

/// What changed for one alert after looking at the latest closes.
#[derive(Debug, PartialEq)]
pub struct Evaluation {
    pub id: String,
    pub triggered: bool,
    pub fired: Option<AlertFired>,
}

/// Evaluates enabled alerts against `(date, close)` per symbol. Returns only alerts whose
/// stored state changes: newly fired, or re-armed because the price moved back.
pub fn evaluate(
    records: &[AlertRecord],
    latest: &HashMap<String, (NaiveDate, f64)>,
) -> Vec<Evaluation> {
    records
        .iter()
        .filter(|record| record.enabled)
        .filter_map(|record| {
            let (date, close) = latest.get(&record.alert.symbol)?;
            let met = is_met(&record.alert, *close);
            match (met, record.triggered) {
                (true, false) => Some(Evaluation {
                    id: record.alert.id.clone(),
                    triggered: true,
                    fired: Some(AlertFired {
                        alert: record.alert.clone(),
                        close: *close,
                        date: *date,
                    }),
                }),
                (false, true) => Some(Evaluation {
                    id: record.alert.id.clone(),
                    triggered: false,
                    fired: None,
                }),
                _ => None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(direction: Direction, threshold: f64, triggered: bool, enabled: bool) -> AlertRecord {
        AlertRecord {
            alert: PriceAlert {
                id: "a".into(),
                symbol: "ZC".into(),
                direction,
                threshold,
            },
            enabled,
            triggered,
        }
    }
    fn latest(close: f64) -> HashMap<String, (NaiveDate, f64)> {
        HashMap::from([(
            "ZC".to_string(),
            (NaiveDate::from_ymd_opt(2026, 10, 23).unwrap(), close),
        )])
    }

    #[test]
    fn fires_once_when_the_threshold_is_crossed() {
        let result = evaluate(&[record(Direction::Above, 4.5, false, true)], &latest(4.55));
        assert_eq!(result.len(), 1);
        let fired = result[0].fired.as_ref().unwrap();
        assert_eq!(fired.alert.threshold, 4.5);
        assert_eq!(fired.close, 4.55);
        assert_eq!(
            serde_json::to_value(fired).unwrap(),
            serde_json::json!({
                "id": "a",
                "symbol": "ZC",
                "direction": "above",
                "threshold": 4.5,
                "close": 4.55,
                "date": "2026-10-23"
            })
        );
        assert!(result[0].triggered);
        // Already triggered and still beyond the line: nothing to do.
        assert!(evaluate(&[record(Direction::Above, 4.5, true, true)], &latest(4.6)).is_empty());
    }

    #[test]
    fn re_arms_when_the_price_moves_back() {
        let result = evaluate(&[record(Direction::Above, 4.5, true, true)], &latest(4.4));
        assert_eq!(
            result,
            vec![Evaluation {
                id: "a".into(),
                triggered: false,
                fired: None
            }]
        );
    }

    #[test]
    fn below_alerts_and_the_exact_threshold() {
        assert_eq!(
            evaluate(&[record(Direction::Below, 4.0, false, true)], &latest(4.0)).len(),
            1
        );
        assert!(evaluate(&[record(Direction::Below, 4.0, false, true)], &latest(4.01)).is_empty());
    }

    #[test]
    fn disabled_alerts_and_missing_prices_do_nothing() {
        assert!(evaluate(&[record(Direction::Above, 1.0, false, false)], &latest(9.0)).is_empty());
        assert!(
            evaluate(
                &[record(Direction::Above, 1.0, false, true)],
                &HashMap::new()
            )
            .is_empty()
        );
    }

    #[test]
    fn validation_rejects_bad_alerts() {
        let ok = PriceAlert {
            id: "a".into(),
            symbol: "ZC".into(),
            direction: Direction::Above,
            threshold: 4.0,
        };
        assert!(validate(&ok).is_ok());
        assert!(
            validate(&PriceAlert {
                symbol: "XX".into(),
                ..ok.clone()
            })
            .is_err()
        );
        assert!(
            validate(&PriceAlert {
                threshold: -1.0,
                ..ok.clone()
            })
            .is_err()
        );
        assert!(
            validate(&PriceAlert {
                threshold: f64::NAN,
                ..ok
            })
            .is_err()
        );
    }
}

/// River alerts: built-in rules for every configured gauge rather than levels the user types, since
/// the thresholds already live in `config/waterways.json`. Each fires once when its condition
/// starts and re-arms when it ends; the band rule fires each time the score moves up a band.
pub mod river {
    use std::collections::HashMap;

    use chrono::NaiveDate;
    use serde::{Deserialize, Serialize};

    use crate::analytics::river::RiverStatus;
    use crate::sources::river::WaterwaysConfig;

    #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum RiverRule {
        BelowRestriction,
        BelowCritical,
        ForecastRestriction,
        BandUp,
    }

    impl RiverRule {
        pub const ALL: [RiverRule; 4] = [
            RiverRule::BelowRestriction,
            RiverRule::BelowCritical,
            RiverRule::ForecastRestriction,
            RiverRule::BandUp,
        ];

        fn slug(self) -> &'static str {
            match self {
                RiverRule::BelowRestriction => "below_restriction",
                RiverRule::BelowCritical => "below_critical",
                RiverRule::ForecastRestriction => "forecast_restriction",
                RiverRule::BandUp => "band_up",
            }
        }
    }

    pub fn alert_id(gauge_id: &str, rule: RiverRule) -> String {
        format!("river:{gauge_id}:{}", rule.slug())
    }

    /// A rule with its stored state. `state` is 1 while a condition holds, or the band reached
    /// (0 normal, 1 elevated, 2 high) for the band rule.
    #[derive(Clone, Debug, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RiverAlertRecord {
        pub id: String,
        pub gauge_id: String,
        pub gauge_name: String,
        pub rule: RiverRule,
        pub description: String,
        pub enabled: bool,
        pub state: i64,
    }

    #[derive(Clone, Debug, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RiverAlertFired {
        pub id: String,
        pub gauge_id: String,
        pub rule: RiverRule,
        pub title: String,
        pub body: String,
        pub date: NaiveDate,
    }

    #[derive(Debug, PartialEq)]
    pub struct RiverEvaluation {
        pub id: String,
        pub state: i64,
        pub fired: Option<RiverAlertFired>,
    }

    /// Every rule for every configured gauge, with stored `(enabled, state)` where there is one.
    /// A rule with nothing stored is on and armed.
    pub fn rules(
        config: &WaterwaysConfig,
        stored: &HashMap<String, (bool, i64)>,
    ) -> Vec<RiverAlertRecord> {
        config
            .gauges()
            .flat_map(|(river, gauge)| {
                let thresholds = gauge.thresholds;
                RiverRule::ALL.into_iter().map(move |rule| {
                    let id = alert_id(&gauge.id, rule);
                    let (enabled, state) = stored.get(&id).copied().unwrap_or((true, 0));
                    let description = match rule {
                        RiverRule::BelowRestriction => format!(
                            "{} stage at or below the {:.2} ft restriction level",
                            gauge.name, thresholds.restriction
                        ),
                        RiverRule::BelowCritical => format!(
                            "{} stage at or below the {:.2} ft critical level",
                            gauge.name, thresholds.critical
                        ),
                        RiverRule::ForecastRestriction => format!(
                            "{} forecast reaches the {:.2} ft restriction level within {} days",
                            gauge.name, thresholds.restriction, river.forecast_days
                        ),
                        RiverRule::BandUp => {
                            format!("{} river constraint score moves up a band", gauge.name)
                        }
                    };
                    RiverAlertRecord {
                        id,
                        gauge_id: gauge.id.clone(),
                        gauge_name: gauge.name.clone(),
                        rule,
                        description,
                        enabled,
                        state,
                    }
                })
            })
            .collect()
    }

    fn band_rank(band: &str) -> i64 {
        match band {
            "HIGH" => 2,
            "ELEVATED" => 1,
            _ => 0,
        }
    }

    /// Whether a condition rule holds, or `None` when its input is missing, which leaves the
    /// rule as it was rather than re-arming it.
    fn holds(rule: RiverRule, status: &RiverStatus) -> Option<bool> {
        let stage = status.stage.as_ref().map(|stage| stage.value);
        match rule {
            RiverRule::BelowRestriction => {
                stage.map(|stage| stage <= status.thresholds.restriction)
            }
            RiverRule::BelowCritical => stage.map(|stage| stage <= status.thresholds.critical),
            RiverRule::ForecastRestriction => status
                .forecast_min
                .map(|_| status.restriction_forecast_on.is_some()),
            RiverRule::BandUp => None,
        }
    }

    fn message(rule: RiverRule, status: &RiverStatus) -> (String, String) {
        let stage = status.stage.as_ref().map_or(0.0, |stage| stage.value);
        let gauge = &status.gauge_name;
        match rule {
            RiverRule::BelowRestriction => (
                format!("{gauge} below the restriction level"),
                format!(
                    "Stage {stage:.2} ft is at or below {:.2} ft, where barges usually load lighter.",
                    status.thresholds.restriction
                ),
            ),
            RiverRule::BelowCritical => (
                format!("{gauge} below the critical level"),
                format!(
                    "Stage {stage:.2} ft is at or below the {:.2} ft critical level.",
                    status.thresholds.critical
                ),
            ),
            RiverRule::ForecastRestriction => (
                format!("{gauge} forecast to reach the restriction level"),
                format!(
                    "The latest NWS forecast reaches {:.2} ft by {}; the stage is {stage:.2} ft now.",
                    status.thresholds.restriction,
                    status
                        .restriction_forecast_on
                        .map_or_else(String::new, |day| day.to_string())
                ),
            ),
            RiverRule::BandUp => {
                let score = status.score.as_ref();
                (
                    format!(
                        "{gauge} river constraint {}",
                        score.map_or("", |score| score.band.as_str())
                    ),
                    format!(
                        "The constraint score is {:.0} of 100. River effects tend to show in freight and basis more than futures.",
                        score.map_or(0.0, |score| score.total)
                    ),
                )
            }
        }
    }

    /// Enabled rules whose stored state changes for the gauges' current status.
    pub fn evaluate(
        records: &[RiverAlertRecord],
        statuses: &HashMap<String, RiverStatus>,
    ) -> Vec<RiverEvaluation> {
        records
            .iter()
            .filter(|record| record.enabled)
            .filter_map(|record| {
                let status = statuses.get(&record.gauge_id)?;
                let date = status.as_of.date_naive();
                let fire = |state: i64| {
                    let (title, body) = message(record.rule, status);
                    RiverEvaluation {
                        id: record.id.clone(),
                        state,
                        fired: Some(RiverAlertFired {
                            id: record.id.clone(),
                            gauge_id: record.gauge_id.clone(),
                            rule: record.rule,
                            title,
                            body,
                            date,
                        }),
                    }
                };
                if record.rule == RiverRule::BandUp {
                    let rank = band_rank(&status.score.as_ref()?.band);
                    return match rank.cmp(&record.state) {
                        std::cmp::Ordering::Greater => Some(fire(rank)),
                        std::cmp::Ordering::Less => Some(RiverEvaluation {
                            id: record.id.clone(),
                            state: rank,
                            fired: None,
                        }),
                        std::cmp::Ordering::Equal => None,
                    };
                }
                match (holds(record.rule, status)?, record.state > 0) {
                    (true, false) => Some(fire(1)),
                    (false, true) => Some(RiverEvaluation {
                        id: record.id.clone(),
                        state: 0,
                        fired: None,
                    }),
                    _ => None,
                }
            })
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::analytics::river::{ConstraintScore, InputValue};
        use crate::sources::river::{BUNDLED_WATERWAYS, parse_waterways};
        use chrono::{DateTime, Utc};

        fn config() -> WaterwaysConfig {
            parse_waterways(BUNDLED_WATERWAYS).unwrap()
        }

        fn status(
            stage: Option<f64>,
            forecast_on: Option<&str>,
            band: Option<&str>,
        ) -> RiverStatus {
            let at = DateTime::parse_from_rfc3339("2026-10-31T21:00:00Z")
                .unwrap()
                .with_timezone(&Utc);
            let (_, gauge) = config()
                .gauges()
                .find(|(_, gauge)| gauge.id == "stlouis")
                .map(|(river, gauge)| (river.clone(), gauge.clone()))
                .unwrap();
            RiverStatus {
                gauge_id: gauge.id.clone(),
                gauge_name: gauge.name.clone(),
                river_name: "Mississippi River".into(),
                unit: "ft".into(),
                thresholds: gauge.thresholds,
                provisional: true,
                as_of: at,
                stage: stage.map(|value| InputValue {
                    period: at.date_naive(),
                    value,
                    released_at: at,
                    fetched_at: at,
                    source_id: "usgs-river-stage".into(),
                }),
                stage_band: None,
                forecast_issued_at: forecast_on.map(|_| at),
                forecast_fetched_at: None,
                forecast: Vec::new(),
                forecast_min: forecast_on.map(|_| 0.5).or(Some(3.0)),
                restriction_forecast_on: forecast_on
                    .map(|day| NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap()),
                barge_rate: None,
                traffic: None,
                score: band.map(|band| ConstraintScore {
                    total: 55.0,
                    band: band.into(),
                    depth: None,
                    forecast: None,
                    traffic: None,
                    partial: false,
                }),
                pressure: None,
            }
        }

        fn record(rule: RiverRule, state: i64, enabled: bool) -> RiverAlertRecord {
            let mut record = rules(&config(), &HashMap::new())
                .into_iter()
                .find(|record| record.gauge_id == "stlouis" && record.rule == rule)
                .unwrap();
            record.state = state;
            record.enabled = enabled;
            record
        }

        fn run(record: RiverAlertRecord, status: RiverStatus) -> Vec<RiverEvaluation> {
            evaluate(&[record], &HashMap::from([("stlouis".to_string(), status)]))
        }

        #[test]
        fn every_gauge_gets_every_rule_armed_by_default() {
            let all = rules(&config(), &HashMap::new());
            assert_eq!(all.len(), 8);
            assert!(all.iter().all(|record| record.enabled && record.state == 0));
            assert_eq!(all[0].id, "river:stlouis:below_restriction");
            assert!(all[0].description.contains("1.00 ft restriction level"));
            let stored = HashMap::from([("river:memphis:band_up".to_string(), (false, 1))]);
            let memphis = rules(&config(), &stored)
                .into_iter()
                .find(|record| record.id == "river:memphis:band_up")
                .unwrap();
            assert!(!memphis.enabled && memphis.state == 1);
        }

        #[test]
        fn a_stage_crossing_fires_once_and_re_arms_when_the_river_rises() {
            let fired = run(
                record(RiverRule::BelowRestriction, 0, true),
                status(Some(0.8), None, None),
            );
            assert_eq!(fired.len(), 1);
            assert_eq!(fired[0].state, 1);
            let alert = fired[0].fired.as_ref().unwrap();
            assert_eq!(alert.title, "St. Louis, MO below the restriction level");
            assert!(alert.body.contains("0.80 ft"));
            // Still below: nothing new.
            assert!(
                run(
                    record(RiverRule::BelowRestriction, 1, true),
                    status(Some(0.5), None, None)
                )
                .is_empty()
            );
            // Back above: re-armed without a notification.
            assert_eq!(
                run(
                    record(RiverRule::BelowRestriction, 1, true),
                    status(Some(1.5), None, None)
                ),
                vec![RiverEvaluation {
                    id: "river:stlouis:below_restriction".into(),
                    state: 0,
                    fired: None
                }]
            );
            // A missing reading leaves the rule as it was.
            assert!(
                run(
                    record(RiverRule::BelowRestriction, 1, true),
                    status(None, None, None)
                )
                .is_empty()
            );
            // Paused rules do nothing.
            assert!(
                run(
                    record(RiverRule::BelowCritical, 0, false),
                    status(Some(-5.0), None, None)
                )
                .is_empty()
            );
        }

        #[test]
        fn the_forecast_rule_fires_when_the_forecast_reaches_the_restriction_level() {
            let fired = run(
                record(RiverRule::ForecastRestriction, 0, true),
                status(Some(2.0), Some("2026-11-04"), None),
            );
            assert!(
                fired[0]
                    .fired
                    .as_ref()
                    .unwrap()
                    .body
                    .contains("by 2026-11-04")
            );
            // The forecast recovers: re-armed.
            assert_eq!(
                run(
                    record(RiverRule::ForecastRestriction, 1, true),
                    status(Some(2.0), None, None)
                )[0]
                .state,
                0
            );
        }

        #[test]
        fn the_band_rule_fires_on_each_move_up_and_follows_moves_down_quietly() {
            let up = run(
                record(RiverRule::BandUp, 0, true),
                status(Some(2.0), None, Some("ELEVATED")),
            );
            assert_eq!(up[0].state, 1);
            assert!(up[0].fired.as_ref().unwrap().title.ends_with("ELEVATED"));
            assert_eq!(
                run(
                    record(RiverRule::BandUp, 1, true),
                    status(Some(2.0), None, Some("HIGH"))
                )[0]
                .state,
                2
            );
            assert!(
                run(
                    record(RiverRule::BandUp, 2, true),
                    status(Some(2.0), None, Some("HIGH"))
                )
                .is_empty()
            );
            let down = run(
                record(RiverRule::BandUp, 2, true),
                status(Some(2.0), None, Some("NORMAL")),
            );
            assert_eq!(
                down,
                vec![RiverEvaluation {
                    id: "river:stlouis:band_up".into(),
                    state: 0,
                    fired: None
                }]
            );
        }

        #[test]
        fn alert_wording_never_claims_cause() {
            for rule in RiverRule::ALL {
                let (title, body) =
                    message(rule, &status(Some(0.8), Some("2026-11-04"), Some("HIGH")));
                for text in [title, body] {
                    for banned in crate::analytics::backtest::BANNED_PHRASES {
                        assert!(!text.to_lowercase().contains(banned), "{text}");
                    }
                }
            }
        }
    }
}
