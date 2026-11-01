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

    use crate::analytics::river::{BAND_NAMES, RiverPoint, RiverStatus, next_band};
    use crate::sources::river::{Bands, Gauge, Thresholds, WaterwaysConfig};

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

    /// What the rules need to know about a gauge on one day.
    #[derive(Clone, Copy, Debug, Default, PartialEq)]
    pub struct RuleInputs {
        pub stage: Option<f64>,
        /// Lowest stage over the forecast window, from a current forecast.
        pub forecast_min: Option<f64>,
        pub score: Option<f64>,
    }

    impl RuleInputs {
        pub fn of_status(status: &RiverStatus) -> Self {
            Self {
                stage: status.stage.as_ref().map(|stage| stage.value),
                forecast_min: status.forecast_min,
                score: status.score.as_ref().map(|score| score.total),
            }
        }

        pub fn of_point(point: &RiverPoint) -> Self {
            Self {
                stage: point.stage,
                forecast_min: point.forecast_min,
                score: point.score,
            }
        }
    }

    /// One rule's new state for a day's inputs, and whether it fires. A condition rule fires when
    /// its condition starts and re-arms once the level is `rearm_ft` back above its threshold, so
    /// a river hovering at a threshold does not notify again and again. The band rule follows the
    /// score with the band margin and fires on each move up. Missing inputs change nothing.
    pub fn step(
        rule: RiverRule,
        state: i64,
        inputs: &RuleInputs,
        thresholds: &Thresholds,
        bands: &Bands,
        rearm_ft: f64,
    ) -> (i64, bool) {
        let condition = |met: bool, clear: bool| match (state > 0, met, clear) {
            (false, true, _) => (1, true),
            (true, _, true) => (0, false),
            _ => (state, false),
        };
        match (rule, inputs.stage, inputs.forecast_min, inputs.score) {
            (RiverRule::BelowRestriction, Some(stage), _, _) => condition(
                stage <= thresholds.restriction,
                stage > thresholds.restriction + rearm_ft,
            ),
            (RiverRule::BelowCritical, Some(stage), _, _) => condition(
                stage <= thresholds.critical,
                stage > thresholds.critical + rearm_ft,
            ),
            (RiverRule::ForecastRestriction, Some(stage), Some(low), _) => condition(
                stage > thresholds.restriction && low <= thresholds.restriction,
                low > thresholds.restriction + rearm_ft,
            ),
            (RiverRule::BandUp, _, _, Some(score)) => {
                let next = i64::from(next_band(state.clamp(0, 2) as u8, score, bands));
                (next, next > state)
            }
            _ => (state, false),
        }
    }

    fn message(rule: RiverRule, status: &RiverStatus, rank: i64) -> (String, String) {
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
                    status.restriction_forecast_on.map_or_else(
                        || "the end of the forecast window".to_string(),
                        |day| day.to_string()
                    )
                ),
            ),
            RiverRule::BandUp => (
                format!(
                    "{gauge} river constraint {}",
                    BAND_NAMES[rank.clamp(0, 2) as usize]
                ),
                format!(
                    "The constraint score is {:.0} of 100. River effects tend to show in freight and basis more than futures.",
                    status.score.as_ref().map_or(0.0, |score| score.total)
                ),
            ),
        }
    }

    /// Enabled rules whose stored state changes for the gauges' current status.
    pub fn evaluate(
        records: &[RiverAlertRecord],
        statuses: &HashMap<String, RiverStatus>,
        bands: &Bands,
        rearm_ft: f64,
    ) -> Vec<RiverEvaluation> {
        records
            .iter()
            .filter(|record| record.enabled)
            .filter_map(|record| {
                let status = statuses.get(&record.gauge_id)?;
                let (state, fired) = step(
                    record.rule,
                    record.state,
                    &RuleInputs::of_status(status),
                    &status.thresholds,
                    bands,
                    rearm_ft,
                );
                (state != record.state || fired).then(|| RiverEvaluation {
                    id: record.id.clone(),
                    state,
                    fired: fired.then(|| {
                        let (title, body) = message(record.rule, status, state);
                        RiverAlertFired {
                            id: record.id.clone(),
                            gauge_id: record.gauge_id.clone(),
                            rule: record.rule,
                            title,
                            body,
                            date: status.as_of.date_naive(),
                        }
                    }),
                })
            })
            .collect()
    }

    /// Every day a rule would have fired over a timeline, with every rule switched on.
    pub fn replay(
        gauge: &Gauge,
        bands: &Bands,
        rearm_ft: f64,
        points: &[RiverPoint],
    ) -> Vec<(NaiveDate, RiverRule)> {
        let mut states = [0_i64; 4];
        let mut fired = Vec::new();
        for point in points {
            let inputs = RuleInputs::of_point(point);
            for (state, rule) in states.iter_mut().zip(RiverRule::ALL) {
                let (next, fires) = step(rule, *state, &inputs, &gauge.thresholds, bands, rearm_ft);
                *state = next;
                if fires {
                    fired.push((point.date, rule));
                }
            }
        }
        fired
    }

    /// A week-on-week rise in the barge rate at least this large starts or extends a freight episode.
    pub const FREIGHT_JUMP_PERCENT: f64 = 25.0;
    /// Jumps this close to the last one belong to the same episode.
    const EPISODE_GAP_DAYS: i64 = 28;
    /// Alerts this close to the first of a run count as one warning.
    const WARNING_CLUSTER_DAYS: i64 = 14;
    /// A warning counts for an episode that starts within this many days after it.
    pub const LEAD_WINDOW_DAYS: i64 = 42;

    #[derive(Clone, Debug, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FreightEpisode {
        /// The day the first jump of the episode was published.
        pub start: NaiveDate,
        pub rise_percent: f64,
        /// The stage that day, to tell low-water episodes from harvest demand.
        pub stage: Option<f64>,
        /// Days from the earliest warning in the lead window to the start, if there was one.
        pub warned_days_before: Option<i64>,
    }

    #[derive(Clone, Debug, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GaugeBacktest {
        pub gauge_id: String,
        pub gauge_name: String,
        pub from: Option<NaiveDate>,
        pub to: Option<NaiveDate>,
        pub episodes: Vec<FreightEpisode>,
        /// Episodes with a warning in the lead window.
        pub warned_episodes: usize,
        pub alerts: usize,
        pub alerts_per_year: f64,
        /// Runs of alerts, counted once per run.
        pub warnings: usize,
        /// Warnings followed by an episode start within the lead window.
        pub warnings_followed: usize,
    }

    /// Replays the river alerts over a timeline and checks them against barge-freight episodes:
    /// weeks the published rate rose 25% or more. Episodes come from the data, not from labels, and
    /// include harvest-demand jumps at high water, which the river alerts are not meant to catch.
    pub fn backtest(
        gauge: &Gauge,
        bands: &Bands,
        rearm_ft: f64,
        points: &[RiverPoint],
    ) -> GaugeBacktest {
        let mut episodes: Vec<FreightEpisode> = Vec::new();
        let mut last_jump: Option<NaiveDate> = None;
        let mut last_rate: Option<f64> = None;
        for point in points {
            let Some(rate) = point.barge_rate else {
                continue;
            };
            if let Some(before) = last_rate.filter(|before| *before > 0.0 && *before != rate) {
                let rise = (rate / before - 1.0) * 100.0;
                if rise >= FREIGHT_JUMP_PERCENT {
                    let continues = last_jump
                        .is_some_and(|last| (point.date - last).num_days() <= EPISODE_GAP_DAYS);
                    if !continues {
                        episodes.push(FreightEpisode {
                            start: point.date,
                            rise_percent: rise,
                            stage: point.stage,
                            warned_days_before: None,
                        });
                    }
                    last_jump = Some(point.date);
                }
            }
            last_rate = Some(rate);
        }
        let alerts = replay(gauge, bands, rearm_ft, points);
        let mut warnings: Vec<NaiveDate> = Vec::new();
        for (date, _) in &alerts {
            if warnings
                .last()
                .is_none_or(|first| (*date - *first).num_days() > WARNING_CLUSTER_DAYS)
            {
                warnings.push(*date);
            }
        }
        let window = |warning: NaiveDate, start: NaiveDate| {
            (0..=LEAD_WINDOW_DAYS).contains(&(start - warning).num_days())
        };
        for episode in &mut episodes {
            episode.warned_days_before = warnings
                .iter()
                .filter(|warning| window(**warning, episode.start))
                .map(|warning| (episode.start - *warning).num_days())
                .max();
        }
        let warnings_followed = warnings
            .iter()
            .filter(|warning| {
                episodes
                    .iter()
                    .any(|episode| window(**warning, episode.start))
            })
            .count();
        let (from, to) = (
            points.first().map(|point| point.date),
            points.last().map(|point| point.date),
        );
        let years = match (from, to) {
            (Some(from), Some(to)) => ((to - from).num_days() as f64 / 365.25).max(1.0 / 365.25),
            _ => 1.0,
        };
        GaugeBacktest {
            gauge_id: gauge.id.clone(),
            gauge_name: gauge.name.clone(),
            from,
            to,
            warned_episodes: episodes
                .iter()
                .filter(|episode| episode.warned_days_before.is_some())
                .count(),
            episodes,
            alerts: alerts.len(),
            alerts_per_year: alerts.len() as f64 / years,
            warnings: warnings.len(),
            warnings_followed,
        }
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
            score: Option<f64>,
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
                score: score.map(|total| ConstraintScore {
                    total,
                    band: BAND_NAMES
                        [crate::analytics::river::band_rank(total, &config().bands) as usize]
                        .into(),
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
            let config = config();
            evaluate(
                &[record],
                &HashMap::from([("stlouis".to_string(), status)]),
                &config.bands,
                config.alerts.rearm_ft,
            )
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
            // Just back above the level is not enough to re-arm.
            assert!(
                run(
                    record(RiverRule::BelowRestriction, 1, true),
                    status(Some(1.5), None, None)
                )
                .is_empty()
            );
            // A foot above it, the rule re-arms without a notification.
            assert_eq!(
                run(
                    record(RiverRule::BelowRestriction, 1, true),
                    status(Some(2.5), None, None)
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
            // 42 is ELEVATED on screen but not past the 5-point margin.
            assert!(
                run(
                    record(RiverRule::BandUp, 0, true),
                    status(Some(2.0), None, Some(42.0))
                )
                .is_empty()
            );
            let up = run(
                record(RiverRule::BandUp, 0, true),
                status(Some(2.0), None, Some(50.0)),
            );
            assert_eq!(up[0].state, 1);
            assert!(up[0].fired.as_ref().unwrap().title.ends_with("ELEVATED"));
            assert_eq!(
                run(
                    record(RiverRule::BandUp, 1, true),
                    status(Some(2.0), None, Some(80.0))
                )[0]
                .state,
                2
            );
            assert!(
                run(
                    record(RiverRule::BandUp, 2, true),
                    status(Some(2.0), None, Some(68.0))
                )
                .is_empty()
            );
            let down = run(
                record(RiverRule::BandUp, 2, true),
                status(Some(2.0), None, Some(20.0)),
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
                    message(rule, &status(Some(0.8), Some("2026-11-04"), Some(80.0)), 2);
                for text in [title, body] {
                    for banned in crate::analytics::backtest::BANNED_PHRASES {
                        assert!(!text.to_lowercase().contains(banned), "{text}");
                    }
                }
            }
        }

        fn day(value: &str) -> NaiveDate {
            NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
        }

        fn point(date: NaiveDate, stage: f64, rate: f64) -> RiverPoint {
            RiverPoint {
                date,
                close: None,
                stage: Some(stage),
                stage_low: None,
                stage_mean: None,
                stage_high: None,
                forecast_min: Some(stage),
                barge_rate: Some(rate),
                score: None,
                band: None,
                partial: false,
                basis_spread: None,
            }
        }

        #[test]
        fn the_backtest_finds_freight_episodes_and_the_warnings_before_them() {
            let config = config();
            let (_, gauge) = config.gauge("stlouis").unwrap();
            let start = day("2026-06-01");
            // The river falls below the 1.0 ft restriction level on day 20; freight jumps 30% on
            // day 40 and again on day 54 (one episode), then a harvest jump at high water on day 150.
            let points: Vec<RiverPoint> = (0..200)
                .map(|offset| {
                    let stage = if (20..100).contains(&offset) {
                        0.5
                    } else {
                        6.0
                    };
                    let rate = match offset {
                        0..40 => 400.0,
                        40..54 => 520.0,
                        54..150 => 700.0,
                        _ => 910.0,
                    };
                    point(start + chrono::Duration::days(offset), stage, rate)
                })
                .collect();
            let report = backtest(gauge, &config.bands, config.alerts.rearm_ft, &points);
            assert_eq!(report.episodes.len(), 2);
            assert_eq!(report.episodes[0].start, start + chrono::Duration::days(40));
            assert!((report.episodes[0].rise_percent - 30.0).abs() < 1e-9);
            assert_eq!(report.episodes[0].warned_days_before, Some(20));
            assert_eq!(report.episodes[1].stage, Some(6.0));
            assert_eq!(report.episodes[1].warned_days_before, None);
            assert_eq!(report.warned_episodes, 1);
            // One alert below the restriction level on day 20; recovery re-arms it without a new one.
            assert_eq!(
                replay(gauge, &config.bands, config.alerts.rearm_ft, &points),
                vec![(
                    start + chrono::Duration::days(20),
                    RiverRule::BelowRestriction
                )]
            );
            assert_eq!((report.warnings, report.warnings_followed), (1, 1));
        }
    }
}
