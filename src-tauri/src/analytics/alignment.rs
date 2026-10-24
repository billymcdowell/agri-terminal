use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

use crate::core::{MetricObservation, Observation};

/// Futures settle by 20:00 UTC in every season, so a daily bar is treated as known to the market
/// from then on. Fetch time would let a bar pulled days later see reports published after its day.
const MARKET_CLOSE_HOUR_UTC: u32 = 20;

pub fn market_close(period: NaiveDate) -> DateTime<Utc> {
    period
        .and_hms_opt(MARKET_CLOSE_HOUR_UTC, 0, 0)
        .expect("a fixed hour is always valid")
        .and_utc()
}

/// The newest report visible at `as_of`: the latest period released by then, at its latest revision
/// released by then. Later revisions and later periods are ignored, so nothing is looked ahead.
pub fn visible_as_of(
    revisions: &[MetricObservation],
    as_of: DateTime<Utc>,
) -> Option<&MetricObservation> {
    revisions
        .iter()
        .filter(|row| row.released_at <= as_of)
        .max_by_key(|row| (row.period, row.revision))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignedMetric {
    pub period: NaiveDate,
    pub value: f64,
    pub released_at: DateTime<Utc>,
    pub revision: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignedPoint {
    pub date: NaiveDate,
    pub close: f64,
    pub metric: Option<AlignedMetric>,
}

/// Joins each daily bar to the metric a trader could have seen at that day's close. When
/// `max_age_days` is set, a report older than that (by its own period) is dropped rather than
/// carried across an off-season gap.
pub fn as_of_join(
    prices: &[Observation],
    metric_revisions: &[MetricObservation],
    max_age_days: Option<i64>,
) -> Vec<AlignedPoint> {
    prices
        .iter()
        .map(|bar| AlignedPoint {
            date: bar.period,
            close: bar.close,
            metric: visible_as_of(metric_revisions, market_close(bar.period))
                .filter(|row| {
                    max_age_days.is_none_or(|limit| (bar.period - row.period).num_days() <= limit)
                })
                .map(|row| AlignedMetric {
                    period: row.period,
                    value: row.value,
                    released_at: row.released_at,
                    revision: row.revision,
                }),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{SeriesId, SourceId, Unit};

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }
    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }
    fn metric(period: &str, released: &str, revision: u32, value: f64) -> MetricObservation {
        MetricObservation {
            series_id: SeriesId::from("cot.ZC.managed_money_net"),
            period: day(period),
            released_at: at(released),
            value,
            unit: "contracts".into(),
            source_id: SourceId::from("cftc-cot"),
            // Fetch time is deliberately far later than release: the join must ignore it.
            fetched_at: at("2026-12-31T00:00:00Z"),
            revision,
        }
    }
    fn bar(period: &str, close: f64) -> Observation {
        Observation {
            series_id: SeriesId::from("price.ZC.close"),
            period: day(period),
            released_at: at("2026-12-31T00:00:00Z"),
            open: close,
            high: close,
            low: close,
            close,
            unit: Unit::UsdPerBushel,
            source_id: SourceId::from("databento"),
            fetched_at: at("2026-12-31T00:00:00Z"),
            revision: 0,
        }
    }

    #[test]
    fn a_weekly_report_is_never_used_before_it_was_public() {
        // Tuesday positions are published the following Friday evening.
        let reports = [
            metric("2026-10-06", "2026-10-09T19:30:00Z", 0, 100.0),
            metric("2026-10-13", "2026-10-16T19:30:00Z", 0, 200.0),
        ];
        let joined = as_of_join(
            &[
                bar("2026-10-09", 4.0),
                bar("2026-10-15", 4.1),
                bar("2026-10-16", 4.2),
                bar("2026-10-05", 3.9),
            ],
            &reports,
            None,
        );
        // Friday 9th: the 19:30 release precedes the 20:00 close.
        assert_eq!(joined[0].metric.as_ref().unwrap().value, 100.0);
        // Thursday 15th: Tuesday 13th data is not out until the next day.
        assert_eq!(joined[1].metric.as_ref().unwrap().value, 100.0);
        assert_eq!(joined[2].metric.as_ref().unwrap().value, 200.0);
        // Before the first report there is nothing to show.
        assert!(joined[3].metric.is_none());
    }

    #[test]
    fn a_revision_is_used_only_from_its_own_release_time() {
        let reports = [
            metric("2026-10-13", "2026-10-16T19:30:00Z", 0, 200.0),
            metric("2026-10-13", "2026-10-20T12:00:00Z", 1, 250.0),
        ];
        let joined = as_of_join(
            &[bar("2026-10-19", 4.0), bar("2026-10-20", 4.1)],
            &reports,
            None,
        );
        assert_eq!(joined[0].metric.as_ref().unwrap().revision, 0);
        assert_eq!(joined[1].metric.as_ref().unwrap().value, 250.0);
    }

    #[test]
    fn fetch_time_does_not_leak_into_the_join() {
        let joined = as_of_join(
            &[bar("2026-10-16", 4.2)],
            &[metric("2026-10-13", "2026-10-16T19:30:00Z", 0, 1.0)],
            None,
        );
        assert!(joined[0].metric.is_some());
    }

    #[test]
    fn stale_reports_are_dropped_after_the_age_limit() {
        let reports = [metric("2026-11-03", "2026-11-04T20:00:00Z", 0, 50.0)];
        let joined = as_of_join(
            &[bar("2026-11-10", 4.0), bar("2027-01-12", 4.1)],
            &reports,
            Some(14),
        );
        assert!(joined[0].metric.is_some());
        assert!(
            joined[1].metric.is_none(),
            "winter bars must not show last season's condition"
        );
    }
}
