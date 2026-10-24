//! Backtest harness: checks flagged moves against a labeled file of known drivers.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::attribution::MoveExplanation;

/// Generated wording must never assert cause. Used by tests over every explainer text resource.
#[cfg(test)]
pub const BANNED_PHRASES: &[&str] = &[
    "caused by",
    "because of",
    "due to",
    "driven by",
    "resulted in",
    "triggered by",
];

#[derive(Clone, Debug, Deserialize)]
pub struct LabeledMove {
    pub symbol: String,
    pub date: NaiveDate,
    /// Text that should appear in the top-ranked driver's title.
    pub driver_contains: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct LabelFile {
    pub labels: Vec<LabeledMove>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestReport {
    pub total: usize,
    /// Labeled dates the detector flagged as moves.
    pub detected: usize,
    /// Detected moves whose top-ranked driver matches the label.
    pub top_match: usize,
    pub missed_dates: Vec<NaiveDate>,
    /// Share of detected moves whose top driver matches; absent until something was detected.
    pub top_match_rate: Option<f64>,
}

pub fn evaluate(
    labels: &[LabeledMove],
    explanations: &[(String, MoveExplanation)],
) -> BacktestReport {
    let mut detected = 0;
    let mut top_match = 0;
    let mut missed_dates = Vec::new();
    for label in labels {
        let found = explanations.iter().find(|(symbol, explanation)| {
            *symbol == label.symbol && explanation.price_move.date == label.date
        });
        let Some((_, explanation)) = found else {
            missed_dates.push(label.date);
            continue;
        };
        detected += 1;
        if explanation.drivers.first().is_some_and(|driver| {
            driver
                .title
                .to_lowercase()
                .contains(&label.driver_contains.to_lowercase())
        }) {
            top_match += 1;
        }
    }
    BacktestReport {
        total: labels.len(),
        detected,
        top_match,
        missed_dates,
        top_match_rate: (detected > 0).then(|| top_match as f64 / detected as f64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analytics::attribution::{Driver, LABEL_LIKELY, LABEL_NONE};
    use crate::analytics::moves::PriceMove;
    use chrono::Utc;

    fn explanation(date: &str, title: Option<&str>) -> (String, MoveExplanation) {
        let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
        let drivers = title.map(|title| Driver {
            kind: "scheduled_event".into(),
            title: title.into(),
            url: None,
            source: "x".into(),
            at: Utc::now(),
            label: LABEL_LIKELY.into(),
            score: 1.0,
            reasons: vec![],
        });
        (
            "ZC".into(),
            MoveExplanation {
                price_move: PriceMove {
                    date,
                    previous_date: date.pred_opt().unwrap(),
                    log_return: 0.03,
                    z_score: 3.0,
                },
                label: if drivers.is_some() {
                    LABEL_LIKELY
                } else {
                    LABEL_NONE
                }
                .into(),
                drivers: drivers.into_iter().collect(),
            },
        )
    }
    fn label(date: &str, contains: &str) -> LabeledMove {
        LabeledMove {
            symbol: "ZC".into(),
            date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            driver_contains: contains.into(),
        }
    }

    #[test]
    fn reports_detection_and_top_match_rates() {
        let explanations = [
            explanation("2026-10-16", Some("USDA Export Sales · expected")),
            explanation("2026-10-20", Some("CFTC COT")),
            explanation("2026-10-22", None),
        ];
        let labels = [
            label("2026-10-16", "export sales"),
            label("2026-10-20", "wasde"),
            label("2026-10-22", "wasde"),
            label("2026-10-25", "wasde"),
        ];
        let report = evaluate(&labels, &explanations);
        assert_eq!((report.total, report.detected, report.top_match), (4, 3, 1));
        assert_eq!(
            report.missed_dates,
            vec![NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()]
        );
        assert!((report.top_match_rate.unwrap() - 1.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn an_empty_label_set_has_no_rate() {
        assert_eq!(evaluate(&[], &[]).top_match_rate, None);
    }

    #[test]
    fn label_files_parse() {
        let file: LabelFile = serde_json::from_str(
            r#"{"labels":[{"symbol":"ZC","date":"2026-10-16","driver_contains":"export sales"}]}"#,
        )
        .unwrap();
        assert_eq!(file.labels[0].symbol, "ZC");
    }
}
