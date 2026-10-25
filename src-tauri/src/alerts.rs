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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertFired {
    pub id: String,
    pub title: String,
    pub body: String,
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
                        id: record.alert.id.clone(),
                        title: format!(
                            "{} {} {:.2}",
                            record.alert.symbol,
                            match record.alert.direction {
                                Direction::Above => "at or above",
                                Direction::Below => "at or below",
                            },
                            record.alert.threshold
                        ),
                        body: format!("Latest close {close:.2} USD/bu on {date}."),
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
        assert_eq!(fired.title, "ZC at or above 4.50");
        assert_eq!(fired.body, "Latest close 4.55 USD/bu on 2026-10-23.");
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
