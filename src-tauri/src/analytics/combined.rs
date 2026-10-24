//! Combined views: independent series lined up on one price timeline.

use serde::Serialize;

use super::alignment::{as_of_join, market_close, visible_as_of};
use super::seasonal::seasonal_band;
use crate::core::{MetricObservation, Observation};
use chrono::NaiveDate;

/// Weekly reports are carried forward at most this long, so off-season gaps stay empty.
const MAX_REPORT_AGE_DAYS: i64 = 14;
const SEASONAL_YEARS: i32 = 5;
const SEASONAL_WINDOW_DAYS: i64 = 4;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StressPoint {
    pub date: NaiveDate,
    pub close: f64,
    /// Good plus excellent share of the crop, as last published by this date.
    pub condition: Option<f64>,
    /// Range of the same week over the previous five years.
    pub condition_low: Option<f64>,
    pub condition_high: Option<f64>,
    /// Mean share of the commodity's growing states in drought (D1 or worse), as last published.
    pub drought: Option<f64>,
}

/// Price, crop condition against its five-year range, and drought on one axis. Every value is the
/// latest one released by that day's close, so a weekly report never appears before it was public.
pub fn crop_stress_timeline(
    prices: &[Observation],
    condition: &[MetricObservation],
    drought_by_state: &[Vec<MetricObservation>],
) -> Vec<StressPoint> {
    let aligned_condition = as_of_join(prices, condition, Some(MAX_REPORT_AGE_DAYS));
    // Latest known value per period, for the seasonal comparison.
    let mut history: Vec<(NaiveDate, f64)> = condition
        .iter()
        .filter(|row| {
            !condition
                .iter()
                .any(|other| other.period == row.period && other.revision > row.revision)
        })
        .map(|row| (row.period, row.value))
        .collect();
    history.sort_by_key(|(period, _)| *period);
    prices
        .iter()
        .zip(aligned_condition)
        .map(|(bar, aligned)| {
            let band = aligned.metric.as_ref().and_then(|metric| {
                seasonal_band(
                    &history,
                    metric.period,
                    SEASONAL_YEARS,
                    SEASONAL_WINDOW_DAYS,
                )
            });
            let drought_values: Vec<f64> = drought_by_state
                .iter()
                .filter_map(|state| visible_as_of(state, market_close(bar.period)))
                .filter(|row| (bar.period - row.period).num_days() <= MAX_REPORT_AGE_DAYS)
                .map(|row| row.value)
                .collect();
            StressPoint {
                date: bar.period,
                close: bar.close,
                condition: aligned.metric.map(|metric| metric.value),
                condition_low: band.as_ref().map(|band| band.low),
                condition_high: band.as_ref().map(|band| band.high),
                drought: (!drought_values.is_empty())
                    .then(|| drought_values.iter().sum::<f64>() / drought_values.len() as f64),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{SeriesId, SourceId, Unit};
    use chrono::{DateTime, Utc};

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }
    fn report(series: &str, period: &str, released: &str, value: f64) -> MetricObservation {
        let released_at = DateTime::parse_from_rfc3339(released)
            .unwrap()
            .with_timezone(&Utc);
        MetricObservation {
            series_id: SeriesId::from(series),
            period: day(period),
            released_at,
            value,
            unit: "percent".into(),
            source_id: SourceId::from("test"),
            fetched_at: released_at,
            revision: 0,
        }
    }
    fn bar(period: &str, close: f64) -> Observation {
        let at = DateTime::parse_from_rfc3339("2030-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        Observation {
            series_id: SeriesId::from("price.ZC.close"),
            period: day(period),
            released_at: at,
            open: close,
            high: close,
            low: close,
            close,
            unit: Unit::UsdPerBushel,
            source_id: SourceId::from("test"),
            fetched_at: at,
            revision: 0,
        }
    }

    #[test]
    fn lines_up_price_condition_range_and_drought_without_lookahead() {
        // Condition for the same week in 2024 and 2025 gives a range for 2026.
        let condition = [
            report("c", "2024-07-07", "2024-07-08T20:00:00Z", 60.0),
            report("c", "2025-07-06", "2025-07-07T20:00:00Z", 70.0),
            report("c", "2026-07-05", "2026-07-06T20:00:00Z", 65.0),
            report("c", "2026-07-12", "2026-07-13T20:00:00Z", 40.0),
        ];
        let iowa = vec![report("d", "2026-07-07", "2026-07-09T12:30:00Z", 10.0)];
        let illinois = vec![report("d", "2026-07-07", "2026-07-09T12:30:00Z", 30.0)];
        let timeline = crop_stress_timeline(
            &[
                bar("2026-07-08", 4.0),
                bar("2026-07-10", 4.1),
                bar("2026-07-13", 4.2),
            ],
            &condition,
            &[iowa, illinois],
        );
        // Wednesday: only the 5 July condition is public, and drought for the 7th is not yet.
        assert_eq!(timeline[0].condition, Some(65.0));
        assert_eq!(timeline[0].drought, None);
        assert_eq!(
            (timeline[0].condition_low, timeline[0].condition_high),
            (Some(60.0), Some(70.0))
        );
        // Friday: drought has been published; the 12 July condition has not.
        assert_eq!(timeline[1].condition, Some(65.0));
        assert_eq!(timeline[1].drought, Some(20.0));
        // Monday 13th closes after the 20:00 release of the 12 July report.
        assert_eq!(timeline[2].condition, Some(40.0));
    }

    #[test]
    fn off_season_bars_have_no_condition() {
        let condition = [report("c", "2026-11-01", "2026-11-02T20:00:00Z", 55.0)];
        let timeline = crop_stress_timeline(&[bar("2027-01-12", 4.0)], &condition, &[]);
        assert_eq!(timeline[0].condition, None);
    }
}
