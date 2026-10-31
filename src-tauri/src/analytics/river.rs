//! River constraint index: how far a gauge has fallen towards levels that restrict barge loading,
//! what the forecast expects, and whether grain traffic is dropping. Adapted from
//! `../waterway-index/docs/METHODOLOGY.md`, with weekly lock tonnage in place of daily vessel
//! tracking. Every input is the latest value released by the time asked about, so nothing is
//! looked ahead.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;

use super::alignment::market_close;
use super::seasonal::{SeasonalBand, seasonal_band_sorted};
use crate::core::{MetricObservation, Observation};
use crate::sources::river::{Bands, Gauge, River, Thresholds, Weights};

/// A daily stage older than this is treated as missing.
pub const MAX_STAGE_AGE_DAYS: i64 = 3;
/// A forecast issued longer ago than this is treated as missing.
pub const MAX_FORECAST_AGE_DAYS: i64 = 3;
/// Weekly data: a week ending Tuesday or Saturday is published the Thursday after, so by the
/// following Wednesday the newest week is 8 to 11 days old. Older than this means a missed week.
pub const MAX_WEEKLY_AGE_DAYS: i64 = 14;
/// The traffic component compares the latest week with the average of the four before it.
pub const TRAFFIC_WEEKS: usize = 4;
/// A 50 percent drop in lock tonnage scores the full traffic component.
const FULL_TRAFFIC_DROP: f64 = 0.5;
const SEASONAL_YEARS: i32 = 5;
const SEASONAL_WINDOW_DAYS: i64 = 4;

/// 0 at or above the normal level, 1 at or below the critical level, linear in between.
pub fn deficit(level: f64, thresholds: &Thresholds) -> f64 {
    ((thresholds.normal - level) / (thresholds.normal - thresholds.critical)).clamp(0.0, 1.0)
}

/// 0 when the latest week is at or above the recent average, 1 when it is half of it or less.
pub fn traffic_drop(latest: f64, recent_average: f64) -> f64 {
    if recent_average <= 0.0 {
        return 0.0;
    }
    ((recent_average - latest) / recent_average / FULL_TRAFFIC_DROP).clamp(0.0, 1.0)
}

pub fn band_label(score: f64, bands: &Bands) -> &'static str {
    if score >= bands.high {
        "HIGH"
    } else if score >= bands.elevated {
        "ELEVATED"
    } else {
        "NORMAL"
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ScoreInputs {
    /// Stage today, in feet.
    pub stage: Option<f64>,
    /// Lowest forecast stage over the forecast window.
    pub forecast_min: Option<f64>,
    /// Lock tonnage in the latest week and the average of the weeks before it.
    pub traffic: Option<(f64, f64)>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    /// 0 to 1 before weighting.
    pub value: f64,
    /// The weight used, after re-weighting for missing components.
    pub weight: f64,
    /// `value × weight × 100`: this component's share of the score.
    pub points: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintScore {
    pub total: f64,
    pub band: String,
    pub depth: Option<Component>,
    pub forecast: Option<Component>,
    pub traffic: Option<Component>,
    /// True when a component was missing and the others were re-weighted.
    pub partial: bool,
}

/// `100 × (w_depth·DEPTH + w_fcst·FCST + w_traffic·TRAFFIC)`. Missing components drop out and
/// the remaining weights are scaled up to add to 1; the score is then marked partial. With no
/// component at all there is no score.
pub fn constraint_score(
    thresholds: &Thresholds,
    weights: &Weights,
    bands: &Bands,
    inputs: &ScoreInputs,
) -> Option<ConstraintScore> {
    let values = [
        (
            inputs.stage.map(|stage| deficit(stage, thresholds)),
            weights.depth,
        ),
        (
            inputs.forecast_min.map(|low| deficit(low, thresholds)),
            weights.forecast,
        ),
        (
            inputs
                .traffic
                .map(|(latest, average)| traffic_drop(latest, average)),
            weights.traffic,
        ),
    ];
    let present_weight: f64 = values
        .iter()
        .filter(|(value, _)| value.is_some())
        .map(|(_, weight)| weight)
        .sum();
    if present_weight <= 0.0 {
        return None;
    }
    let partial = values
        .iter()
        .any(|(value, weight)| value.is_none() && *weight > 0.0);
    let [depth, forecast, traffic] = values.map(|(value, weight)| {
        value.map(|value| {
            let weight = weight / present_weight;
            Component {
                value,
                weight,
                points: value * weight * 100.0,
            }
        })
    });
    let total = [&depth, &forecast, &traffic]
        .iter()
        .filter_map(|component| component.as_ref().map(|component| component.points))
        .sum::<f64>();
    Some(ConstraintScore {
        band: band_label(total, bands).into(),
        total,
        depth,
        forecast,
        traffic,
        partial,
    })
}

/// The values of one series as known at a moving point in time. Rows are taken in release order,
/// and a later revision of a period replaces the earlier one, so asking at a time sees exactly
/// what was public then. Times must be asked for in increasing order.
pub struct AsOfSweep<'a> {
    rows: Vec<&'a MetricObservation>,
    next: usize,
    known: BTreeMap<NaiveDate, &'a MetricObservation>,
}

impl<'a> AsOfSweep<'a> {
    pub fn new(revisions: &'a [MetricObservation]) -> Self {
        let mut rows: Vec<&MetricObservation> = revisions.iter().collect();
        rows.sort_by_key(|row| (row.released_at, row.revision));
        Self {
            rows,
            next: 0,
            known: BTreeMap::new(),
        }
    }

    pub fn advance(&mut self, as_of: DateTime<Utc>) -> &BTreeMap<NaiveDate, &'a MetricObservation> {
        while let Some(row) = self.rows.get(self.next) {
            if row.released_at > as_of {
                break;
            }
            let replaces = self
                .known
                .get(&row.period)
                .is_none_or(|known| known.revision <= row.revision);
            if replaces {
                self.known.insert(row.period, row);
            }
            self.next += 1;
        }
        &self.known
    }
}

/// The newest period known, if it is no older than `max_age_days` on `day`.
fn latest_within<'a>(
    known: &BTreeMap<NaiveDate, &'a MetricObservation>,
    day: NaiveDate,
    max_age_days: i64,
) -> Option<&'a MetricObservation> {
    known
        .range(..=day)
        .next_back()
        .map(|(_, row)| *row)
        .filter(|row| (day - row.period).num_days() <= max_age_days)
}

/// The lowest forecast stage for the `days` after `day`, from forecasts issued within the last
/// few days, with the time of the newest issue used.
fn forecast_low(
    known: &BTreeMap<NaiveDate, &MetricObservation>,
    day: NaiveDate,
    days: i64,
    as_of: DateTime<Utc>,
) -> Option<(f64, DateTime<Utc>)> {
    let window: Vec<&MetricObservation> = known
        .range(day + Duration::days(1)..=day + Duration::days(days))
        .map(|(_, row)| *row)
        .collect();
    let newest_issue = window.iter().map(|row| row.released_at).max()?;
    if as_of - newest_issue > Duration::days(MAX_FORECAST_AGE_DAYS) {
        return None;
    }
    let low = window
        .iter()
        .map(|row| row.value)
        .fold(f64::INFINITY, f64::min);
    Some((low, newest_issue))
}

/// Weekly totals over a gauge's locks, for weeks every lock has reported.
fn weekly_lock_totals(locks: &[&BTreeMap<NaiveDate, &MetricObservation>]) -> Vec<(NaiveDate, f64)> {
    let Some(first) = locks.first() else {
        return Vec::new();
    };
    first
        .keys()
        .filter_map(|week| {
            locks
                .iter()
                .map(|lock| lock.get(week).map(|row| row.value))
                .sum::<Option<f64>>()
                .map(|total| (*week, total))
        })
        .collect()
}

/// The latest week's tonnage and the average of the weeks before it, if the latest is current.
fn traffic_inputs(totals: &[(NaiveDate, f64)], day: NaiveDate) -> Option<(NaiveDate, f64, f64)> {
    let visible: Vec<&(NaiveDate, f64)> = totals.iter().filter(|(week, _)| *week <= day).collect();
    let (latest_week, latest) = **visible.last()?;
    if (day - latest_week).num_days() > MAX_WEEKLY_AGE_DAYS || visible.len() <= TRAFFIC_WEEKS {
        return None;
    }
    let before = &visible[visible.len() - 1 - TRAFFIC_WEEKS..visible.len() - 1];
    let average = before.iter().map(|(_, tons)| tons).sum::<f64>() / TRAFFIC_WEEKS as f64;
    Some((latest_week, latest, average))
}

/// Every revision of the series a gauge's score needs.
pub struct GaugeSeries<'a> {
    pub stage: &'a [MetricObservation],
    pub forecast: &'a [MetricObservation],
    pub barge_rate: &'a [MetricObservation],
    /// One entry per lock in the gauge's configuration.
    pub locks: Vec<&'a [MetricObservation]>,
}

/// Latest value of one input and when it was published and fetched, for freshness labels.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputValue {
    pub period: NaiveDate,
    pub value: f64,
    pub released_at: DateTime<Utc>,
    pub fetched_at: DateTime<Utc>,
    pub source_id: String,
}

impl InputValue {
    fn of(row: &MetricObservation) -> Self {
        Self {
            period: row.period,
            value: row.value,
            released_at: row.released_at,
            fetched_at: row.fetched_at,
            source_id: row.source_id.0.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastDay {
    pub date: NaiveDate,
    pub low: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BargeRateStatus {
    pub latest: InputValue,
    /// The 1976 tariff benchmark turned into dollars per short ton.
    pub dollars_per_ton: Option<f64>,
    pub previous: Option<InputValue>,
    /// Percent change from the previous week's quote.
    pub change_percent: Option<f64>,
    pub location: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficStatus {
    pub week: NaiveDate,
    pub tons: f64,
    pub average_tons: f64,
    pub change_percent: f64,
    pub locks: Vec<String>,
    pub released_at: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiverStatus {
    pub gauge_id: String,
    pub gauge_name: String,
    pub river_name: String,
    pub unit: String,
    pub thresholds: Thresholds,
    pub provisional: bool,
    pub as_of: DateTime<Utc>,
    pub stage: Option<InputValue>,
    /// The same time of year over the previous five years.
    pub stage_band: Option<SeasonalBand>,
    pub forecast_issued_at: Option<DateTime<Utc>>,
    pub forecast_fetched_at: Option<DateTime<Utc>>,
    pub forecast: Vec<ForecastDay>,
    pub forecast_min: Option<f64>,
    /// The first forecast day at or below the restriction level, while today is above it.
    pub restriction_forecast_on: Option<NaiveDate>,
    pub barge_rate: Option<BargeRateStatus>,
    pub traffic: Option<TrafficStatus>,
    pub score: Option<ConstraintScore>,
}

/// The newest revision of each period, in period order, for seasonal comparisons.
pub fn latest_values(revisions: &[MetricObservation]) -> Vec<(NaiveDate, f64)> {
    let mut latest: BTreeMap<NaiveDate, &MetricObservation> = BTreeMap::new();
    for row in revisions {
        let replaces = latest
            .get(&row.period)
            .is_none_or(|known| known.revision <= row.revision);
        if replaces {
            latest.insert(row.period, row);
        }
    }
    latest
        .into_iter()
        .map(|(period, row)| (period, row.value))
        .collect()
}

/// Everything the River status panel shows for one gauge, as known at `as_of`.
pub fn river_status(
    river: &River,
    gauge: &Gauge,
    bands: &Bands,
    series: &GaugeSeries,
    as_of: DateTime<Utc>,
) -> RiverStatus {
    let day = as_of.date_naive();
    let mut stage_sweep = AsOfSweep::new(series.stage);
    let stage = latest_within(stage_sweep.advance(as_of), day, MAX_STAGE_AGE_DAYS);
    let stage_band = stage.and_then(|row| {
        seasonal_band_sorted(
            &latest_values(series.stage),
            row.period,
            SEASONAL_YEARS,
            SEASONAL_WINDOW_DAYS,
        )
    });

    let mut forecast_sweep = AsOfSweep::new(series.forecast);
    let known_forecast = forecast_sweep.advance(as_of);
    let low = forecast_low(known_forecast, day, river.forecast_days, as_of);
    let forecast: Vec<ForecastDay> = if low.is_some() {
        known_forecast
            .range(day + Duration::days(1)..=day + Duration::days(river.forecast_days))
            .map(|(date, row)| ForecastDay {
                date: *date,
                low: row.value,
            })
            .collect()
    } else {
        Vec::new()
    };
    let forecast_fetched_at = low.and_then(|(_, issued)| {
        known_forecast
            .values()
            .filter(|row| row.released_at == issued)
            .map(|row| row.fetched_at)
            .max()
    });
    let restriction_forecast_on = stage
        .filter(|row| row.value > gauge.thresholds.restriction)
        .and_then(|_| {
            forecast
                .iter()
                .find(|day| day.low <= gauge.thresholds.restriction)
                .map(|day| day.date)
        });

    let mut barge_sweep = AsOfSweep::new(series.barge_rate);
    let known_barge = barge_sweep.advance(as_of);
    let location = gauge.barge_location.as_ref().and_then(|id| {
        river
            .barge_locations
            .iter()
            .find(|location| &location.id == id)
    });
    let barge_rate = latest_within(known_barge, day, MAX_WEEKLY_AGE_DAYS).map(|latest| {
        let previous = known_barge
            .range(..latest.period)
            .next_back()
            .map(|(_, row)| *row);
        BargeRateStatus {
            latest: InputValue::of(latest),
            dollars_per_ton: location.map(|location| location.dollars_per_ton(latest.value)),
            change_percent: previous
                .filter(|row| row.value != 0.0)
                .map(|row| (latest.value / row.value - 1.0) * 100.0),
            previous: previous.map(InputValue::of),
            location: location.map_or_else(String::new, |location| location.name.clone()),
        }
    });

    let mut lock_sweeps: Vec<AsOfSweep> = series
        .locks
        .iter()
        .map(|rows| AsOfSweep::new(rows))
        .collect();
    let known_locks: Vec<BTreeMap<NaiveDate, &MetricObservation>> = lock_sweeps
        .iter_mut()
        .map(|sweep| sweep.advance(as_of).clone())
        .collect();
    let totals = weekly_lock_totals(&known_locks.iter().collect::<Vec<_>>());
    let traffic_values = traffic_inputs(&totals, day);
    let traffic = traffic_values.map(|(week, tons, average)| TrafficStatus {
        week,
        tons,
        average_tons: average,
        change_percent: if average > 0.0 {
            (tons / average - 1.0) * 100.0
        } else {
            0.0
        },
        locks: river
            .locks
            .iter()
            .filter(|lock| gauge.locks.contains(&lock.id))
            .map(|lock| lock.name.clone())
            .collect(),
        released_at: known_locks
            .iter()
            .filter_map(|lock| lock.get(&week).map(|row| row.released_at))
            .max()
            .unwrap_or(as_of),
    });

    let score = constraint_score(
        &gauge.thresholds,
        &river.weights,
        bands,
        &ScoreInputs {
            stage: stage.map(|row| row.value),
            forecast_min: low.map(|(low, _)| low),
            traffic: traffic_values.map(|(_, tons, average)| (tons, average)),
        },
    );
    RiverStatus {
        gauge_id: gauge.id.clone(),
        gauge_name: gauge.name.clone(),
        river_name: river.name.clone(),
        unit: gauge.unit.clone(),
        thresholds: gauge.thresholds,
        provisional: gauge.provisional,
        as_of,
        stage: stage.map(InputValue::of),
        stage_band,
        forecast_issued_at: low.map(|(_, issued)| issued),
        forecast_fetched_at,
        forecast_min: low.map(|(low, _)| low),
        forecast,
        restriction_forecast_on,
        barge_rate,
        traffic,
        score,
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiverPoint {
    pub date: NaiveDate,
    /// The futures close that day, when one is stored.
    pub close: Option<f64>,
    pub stage: Option<f64>,
    pub stage_low: Option<f64>,
    pub stage_mean: Option<f64>,
    pub stage_high: Option<f64>,
    /// The lowest stage expected over the forecast window, from the latest forecast.
    pub forecast_min: Option<f64>,
    /// Percent of the 1976 tariff.
    pub barge_rate: Option<f64>,
    pub score: Option<f64>,
    pub band: Option<String>,
    pub partial: bool,
    /// Gulf minus interior basis, once a public interior basis source exists.
    pub basis_spread: Option<f64>,
}

/// One point per calendar day from the first stored stage to `until`, each with what was known at
/// that day's market close.
pub fn river_timeline(
    river: &River,
    gauge: &Gauge,
    bands: &Bands,
    series: &GaugeSeries,
    prices: &[Observation],
    until: NaiveDate,
) -> Vec<RiverPoint> {
    let Some(first) = series.stage.iter().map(|row| row.period).min() else {
        return Vec::new();
    };
    let closes: BTreeMap<NaiveDate, f64> =
        prices.iter().map(|bar| (bar.period, bar.close)).collect();
    let history = latest_values(series.stage);
    let mut stage_sweep = AsOfSweep::new(series.stage);
    let mut forecast_sweep = AsOfSweep::new(series.forecast);
    let mut barge_sweep = AsOfSweep::new(series.barge_rate);
    let mut lock_sweeps: Vec<AsOfSweep> = series
        .locks
        .iter()
        .map(|rows| AsOfSweep::new(rows))
        .collect();
    let mut points = Vec::new();
    let mut day = first;
    while day <= until {
        let as_of = market_close(day);
        let stage = latest_within(stage_sweep.advance(as_of), day, MAX_STAGE_AGE_DAYS);
        let band = seasonal_band_sorted(&history, day, SEASONAL_YEARS, SEASONAL_WINDOW_DAYS);
        let low = forecast_low(
            forecast_sweep.advance(as_of),
            day,
            river.forecast_days,
            as_of,
        );
        let barge = latest_within(barge_sweep.advance(as_of), day, MAX_WEEKLY_AGE_DAYS);
        let known_locks: Vec<&BTreeMap<NaiveDate, &MetricObservation>> = lock_sweeps
            .iter_mut()
            .map(|sweep| sweep.advance(as_of))
            .collect();
        let traffic = traffic_inputs(&weekly_lock_totals(&known_locks), day);
        let score = constraint_score(
            &gauge.thresholds,
            &river.weights,
            bands,
            &ScoreInputs {
                stage: stage.map(|row| row.value),
                forecast_min: low.map(|(low, _)| low),
                traffic: traffic.map(|(_, tons, average)| (tons, average)),
            },
        );
        points.push(RiverPoint {
            date: day,
            close: closes.get(&day).copied(),
            stage: stage.map(|row| row.value),
            stage_low: band.as_ref().map(|band| band.low),
            stage_mean: band.as_ref().map(|band| band.mean),
            stage_high: band.as_ref().map(|band| band.high),
            forecast_min: low.map(|(low, _)| low),
            barge_rate: barge.map(|row| row.value),
            score: score.as_ref().map(|score| score.total),
            band: score.as_ref().map(|score| score.band.clone()),
            partial: score.as_ref().is_some_and(|score| score.partial),
            basis_spread: None,
        });
        day += Duration::days(1);
    }
    points
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{SeriesId, SourceId};
    use crate::sources::river::{BUNDLED_WATERWAYS, parse_waterways};

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }
    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }
    fn row(series: &str, period: &str, released: &str, value: f64) -> MetricObservation {
        MetricObservation {
            series_id: SeriesId::from(series),
            period: day(period),
            released_at: at(released),
            value,
            unit: "ft".into(),
            source_id: SourceId::from("test"),
            fetched_at: at(released),
            revision: 0,
        }
    }
    fn revised(mut row: MetricObservation, revision: u32) -> MetricObservation {
        row.revision = revision;
        row
    }

    const THRESHOLDS: Thresholds = Thresholds {
        normal: 5.0,
        restriction: 1.0,
        critical: -3.5,
    };
    const WEIGHTS: Weights = Weights {
        depth: 0.5,
        forecast: 0.3,
        traffic: 0.2,
    };
    const BANDS: Bands = Bands {
        elevated: 40.0,
        high: 70.0,
    };

    /// Status and timeline for every gauge over a database filled by the live backfill test
    /// (`AGRI_RIVER_DB`), with timings.
    #[test]
    #[ignore = "needs AGRI_RIVER_DB pointing at a database filled with real river history"]
    fn real_history_status_and_timeline() {
        let path = std::env::var("AGRI_RIVER_DB").expect("set AGRI_RIVER_DB");
        let connection = crate::store::open(std::path::Path::new(&path)).unwrap();
        let config = parse_waterways(BUNDLED_WATERWAYS).unwrap();
        for (river, gauge) in config.gauges() {
            let load =
                |series: &str| crate::store::query_metric_revisions(&connection, series).unwrap();
            let stage = load(&gauge.stage_series());
            let forecast = load(&gauge.forecast_series());
            let barge = gauge
                .barge_location
                .as_ref()
                .and_then(|id| {
                    river
                        .barge_locations
                        .iter()
                        .find(|location| &location.id == id)
                })
                .map(|location| load(&location.series()))
                .unwrap_or_default();
            let locks: Vec<Vec<MetricObservation>> = river
                .locks
                .iter()
                .filter(|lock| gauge.locks.contains(&lock.id))
                .map(|lock| load(&lock.series()))
                .collect();
            let series = GaugeSeries {
                stage: &stage,
                forecast: &forecast,
                barge_rate: &barge,
                locks: locks.iter().map(Vec::as_slice).collect(),
            };
            let started = std::time::Instant::now();
            let status = river_status(river, gauge, &config.bands, &series, Utc::now());
            let status_time = started.elapsed();
            let started = std::time::Instant::now();
            let timeline = river_timeline(
                river,
                gauge,
                &config.bands,
                &series,
                &[],
                Utc::now().date_naive(),
            );
            let timeline_time = started.elapsed();
            println!(
                "{}: stage {:?} band {:?} forecast min {:?} barge {:?} traffic {:?}",
                gauge.id,
                status.stage.as_ref().map(|row| (row.period, row.value)),
                status.stage_band.as_ref().map(|band| (band.low, band.high)),
                status.forecast_min,
                status.barge_rate.as_ref().map(|rate| (
                    rate.latest.period,
                    rate.latest.value,
                    rate.dollars_per_ton
                )),
                status.traffic.as_ref().map(|traffic| (
                    traffic.week,
                    traffic.tons,
                    traffic.change_percent
                )),
            );
            println!(
                "{}: score {:?} in {status_time:?}; timeline {} days in {timeline_time:?}",
                gauge.id,
                status
                    .score
                    .as_ref()
                    .map(|score| (score.total, score.band.clone(), score.partial)),
                timeline.len()
            );
            assert!(status.stage.is_some() && status.score.is_some());
            assert!(timeline.len() > 2000);
            let scored = timeline
                .iter()
                .filter(|point| point.score.is_some())
                .count();
            let full = timeline
                .iter()
                .filter(|point| point.score.is_some() && !point.partial)
                .count();
            println!(
                "{}: {scored} days scored, {full} with every component",
                gauge.id
            );
        }
    }

    #[test]
    fn deficit_runs_from_normal_to_critical() {
        assert_eq!(deficit(6.0, &THRESHOLDS), 0.0);
        assert_eq!(deficit(5.0, &THRESHOLDS), 0.0);
        assert_eq!(deficit(0.75, &THRESHOLDS), 0.5);
        assert_eq!(deficit(-3.5, &THRESHOLDS), 1.0);
        assert_eq!(deficit(-8.0, &THRESHOLDS), 1.0);
    }

    #[test]
    fn traffic_scores_a_half_drop_in_full() {
        assert_eq!(traffic_drop(120.0, 100.0), 0.0);
        assert_eq!(traffic_drop(75.0, 100.0), 0.5);
        assert_eq!(traffic_drop(40.0, 100.0), 1.0);
        assert_eq!(traffic_drop(10.0, 0.0), 0.0);
    }

    #[test]
    fn the_score_weights_each_component_with_known_inputs() {
        let score = constraint_score(
            &THRESHOLDS,
            &WEIGHTS,
            &BANDS,
            &ScoreInputs {
                stage: Some(0.75),
                forecast_min: Some(-3.5),
                traffic: Some((75.0, 100.0)),
            },
        )
        .unwrap();
        // 100 × (0.5 × 0.5 + 0.3 × 1 + 0.2 × 0.5) = 65.
        assert!((score.total - 65.0).abs() < 1e-9);
        assert_eq!(score.band, "ELEVATED");
        assert!(!score.partial);
        assert!((score.depth.unwrap().points - 25.0).abs() < 1e-9);
        assert!((score.forecast.unwrap().points - 30.0).abs() < 1e-9);
        assert!((score.traffic.unwrap().points - 10.0).abs() < 1e-9);
    }

    #[test]
    fn missing_components_are_reweighted_and_flagged_partial() {
        let score = constraint_score(
            &THRESHOLDS,
            &WEIGHTS,
            &BANDS,
            &ScoreInputs {
                stage: Some(0.75),
                forecast_min: None,
                traffic: Some((75.0, 100.0)),
            },
        )
        .unwrap();
        // Weights 0.5 and 0.2 become 5/7 and 2/7: 100 × (5/7 × 0.5 + 2/7 × 0.5) = 50.
        assert!((score.total - 50.0).abs() < 1e-9);
        assert!(score.partial);
        assert!(score.forecast.is_none());
        assert!((score.depth.as_ref().unwrap().weight - 5.0 / 7.0).abs() < 1e-9);
        assert_eq!(
            constraint_score(&THRESHOLDS, &WEIGHTS, &BANDS, &ScoreInputs::default()),
            None
        );
        // A component with no weight is not missed.
        let no_traffic = Weights {
            depth: 0.6,
            forecast: 0.4,
            traffic: 0.0,
        };
        let full = constraint_score(
            &THRESHOLDS,
            &no_traffic,
            &BANDS,
            &ScoreInputs {
                stage: Some(5.0),
                forecast_min: Some(5.0),
                traffic: None,
            },
        )
        .unwrap();
        assert!(!full.partial);
    }

    #[test]
    fn band_edges_follow_the_configured_cut_offs() {
        assert_eq!(band_label(39.999, &BANDS), "NORMAL");
        assert_eq!(band_label(40.0, &BANDS), "ELEVATED");
        assert_eq!(band_label(69.999, &BANDS), "ELEVATED");
        assert_eq!(band_label(70.0, &BANDS), "HIGH");
        assert_eq!(band_label(100.0, &BANDS), "HIGH");
    }

    #[test]
    fn the_sweep_sees_each_revision_only_from_its_release() {
        let rows = [
            row("s", "2026-10-01", "2026-10-01T16:00:00Z", 1.0),
            revised(row("s", "2026-10-01", "2026-10-05T12:00:00Z", 1.5), 1),
            row("s", "2026-10-02", "2026-10-02T16:00:00Z", 2.0),
        ];
        let mut sweep = AsOfSweep::new(&rows);
        assert!(sweep.advance(at("2026-10-01T15:00:00Z")).is_empty());
        assert_eq!(
            sweep.advance(at("2026-10-01T20:00:00Z"))[&day("2026-10-01")].value,
            1.0
        );
        let known = sweep.advance(at("2026-10-05T12:00:00Z"));
        assert_eq!(known[&day("2026-10-01")].value, 1.5);
        assert_eq!(known.len(), 2);
    }

    fn gauge_and_river() -> (River, Gauge) {
        let config = parse_waterways(BUNDLED_WATERWAYS).unwrap();
        let river = config.rivers[0].clone();
        let gauge = river.gauges[0].clone();
        (river, gauge)
    }

    #[test]
    fn a_barge_rate_released_thursday_is_not_on_wednesdays_row() {
        let (river, gauge) = gauge_and_river();
        let stage = [
            row(
                "river.stlouis.stage",
                "2026-10-27",
                "2026-10-27T16:00:00Z",
                3.0,
            ),
            row(
                "river.stlouis.stage",
                "2026-10-28",
                "2026-10-28T16:00:00Z",
                3.0,
            ),
            row(
                "river.stlouis.stage",
                "2026-10-29",
                "2026-10-29T16:00:00Z",
                3.0,
            ),
        ];
        let barge = [
            row(
                "river.barge_rate.stlouis",
                "2026-10-20",
                "2026-10-22T18:00:00Z",
                590.0,
            ),
            row(
                "river.barge_rate.stlouis",
                "2026-10-27",
                "2026-10-29T18:00:00Z",
                560.0,
            ),
        ];
        let series = GaugeSeries {
            stage: &stage,
            forecast: &[],
            barge_rate: &barge,
            locks: vec![&[]],
        };
        let timeline = river_timeline(&river, &gauge, &BANDS, &series, &[], day("2026-10-29"));
        assert_eq!(timeline.len(), 3);
        assert_eq!(timeline[1].date, day("2026-10-28"));
        assert_eq!(timeline[1].barge_rate, Some(590.0));
        assert_eq!(timeline[2].barge_rate, Some(560.0));
        // Only depth is known, so the score is partial and equals the depth deficit.
        assert!(timeline[0].partial);
        assert!(
            (timeline[0].score.unwrap() - deficit(3.0, &gauge.thresholds) * 100.0).abs() < 1e-9
        );
    }

    #[test]
    fn the_forecast_component_uses_the_latest_issue_and_expires() {
        let (river, gauge) = gauge_and_river();
        let stage = [row(
            "river.stlouis.stage",
            "2026-10-01",
            "2026-10-01T16:00:00Z",
            4.0,
        )];
        let forecast = [
            // Issued on 1 October for the 2nd and 3rd; the 3rd was revised down on the 2nd.
            row("f", "2026-10-02", "2026-10-01T16:00:00Z", 3.0),
            row("f", "2026-10-03", "2026-10-01T16:00:00Z", 2.0),
            revised(row("f", "2026-10-03", "2026-10-02T16:00:00Z", 0.5), 1),
        ];
        let series = GaugeSeries {
            stage: &stage,
            forecast: &forecast,
            barge_rate: &[],
            locks: vec![&[]],
        };
        let status = river_status(&river, &gauge, &BANDS, &series, at("2026-10-01T20:00:00Z"));
        assert_eq!(status.forecast_min, Some(2.0));
        assert_eq!(status.forecast.len(), 2);
        assert_eq!(status.restriction_forecast_on, None);
        let status = river_status(&river, &gauge, &BANDS, &series, at("2026-10-02T17:00:00Z"));
        assert_eq!(status.forecast_min, Some(0.5));
        // The stage is above the 1.0 ft restriction level and the forecast falls below it on the 3rd.
        assert_eq!(status.restriction_forecast_on, Some(day("2026-10-03")));
        // Four days after the last issue, the forecast is stale and the score is partial.
        let status = river_status(&river, &gauge, &BANDS, &series, at("2026-10-05T20:00:00Z"));
        assert_eq!(status.forecast_min, None);
    }

    #[test]
    fn traffic_compares_the_latest_week_with_the_four_before_it() {
        let (river, gauge) = gauge_and_river();
        let weeks = [
            "2026-09-19",
            "2026-09-26",
            "2026-10-03",
            "2026-10-10",
            "2026-10-17",
        ];
        let tons = [100.0, 100.0, 100.0, 100.0, 60.0];
        let locks: Vec<MetricObservation> = weeks
            .iter()
            .zip(tons)
            .map(|(week, tons)| {
                let released = format!("{}T18:00:00Z", day(week) + Duration::days(5));
                row("river.locks.ms27.grain_tons", week, &released, tons)
            })
            .collect();
        let stage = [row(
            "river.stlouis.stage",
            "2026-10-22",
            "2026-10-22T16:00:00Z",
            5.0,
        )];
        let series = GaugeSeries {
            stage: &stage,
            forecast: &[],
            barge_rate: &[],
            locks: vec![&locks],
        };
        let status = river_status(&river, &gauge, &BANDS, &series, at("2026-10-22T20:00:00Z"));
        let traffic = status.traffic.unwrap();
        assert_eq!(traffic.week, day("2026-10-17"));
        assert_eq!(traffic.average_tons, 100.0);
        assert!((traffic.change_percent + 40.0).abs() < 1e-9);
        assert!((status.score.unwrap().traffic.unwrap().value - 0.8).abs() < 1e-9);
        // The week ending the 17th is published on the 22nd at 18:00, so earlier that day the
        // latest week is the 10th and there are not yet four weeks before it.
        let earlier = river_status(&river, &gauge, &BANDS, &series, at("2026-10-22T12:00:00Z"));
        assert!(earlier.traffic.is_none());
    }

    #[test]
    fn the_stage_band_comes_from_the_same_days_in_earlier_years() {
        let (river, gauge) = gauge_and_river();
        let mut stage: Vec<MetricObservation> = (2021..=2025)
            .map(|year| {
                let period = format!("{year}-10-15");
                row(
                    "s",
                    &period,
                    &format!("{period}T16:00:00Z"),
                    f64::from(year - 2020),
                )
            })
            .collect();
        stage.push(row("s", "2026-10-15", "2026-10-15T16:00:00Z", -1.0));
        let series = GaugeSeries {
            stage: &stage,
            forecast: &[],
            barge_rate: &[],
            locks: vec![&[]],
        };
        let status = river_status(&river, &gauge, &BANDS, &series, at("2026-10-15T20:00:00Z"));
        let band = status.stage_band.unwrap();
        assert_eq!((band.low, band.high, band.years), (1.0, 5.0, 5));
        assert_eq!(status.stage.unwrap().value, -1.0);
    }
}
