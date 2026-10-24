use chrono::{Datelike, NaiveDate};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonalBand {
    pub low: f64,
    pub mean: f64,
    pub high: f64,
    pub years: usize,
}

fn shift_years(date: NaiveDate, years: i32) -> NaiveDate {
    // 29 February falls back to the 28th in non-leap years.
    NaiveDate::from_ymd_opt(date.year() - years, date.month(), date.day())
        .or_else(|| NaiveDate::from_ymd_opt(date.year() - years, date.month(), 28))
        .expect("day 28 exists in every month")
}

/// Low, mean and high of the same time of year over the previous `years` years. Each year
/// contributes the observation closest to the matching date within `window_days`.
/// Needs at least two contributing years to describe a range.
pub fn seasonal_band(
    series: &[(NaiveDate, f64)],
    on: NaiveDate,
    years: i32,
    window_days: i64,
) -> Option<SeasonalBand> {
    let mut values = Vec::new();
    for back in 1..=years {
        let center = shift_years(on, back);
        let closest = series
            .iter()
            .filter(|(date, _)| (*date - center).num_days().abs() <= window_days)
            .min_by_key(|(date, _)| (*date - center).num_days().abs());
        if let Some((_, value)) = closest {
            values.push(*value);
        }
    }
    if values.len() < 2 {
        return None;
    }
    Some(SeasonalBand {
        low: values.iter().copied().fold(f64::INFINITY, f64::min),
        mean: values.iter().sum::<f64>() / values.len() as f64,
        high: values.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        years: values.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[test]
    fn seasonal_band_uses_the_closest_observation_in_each_prior_year() {
        let series = vec![
            (day(2023, 7, 3), 55.0),
            (day(2023, 7, 9), 60.0),
            (day(2024, 7, 9), 70.0),
            (day(2025, 7, 11), 80.0),
            (day(2026, 7, 10), 1_000.0),
        ];
        let band = seasonal_band(&series, day(2026, 7, 10), 5, 7).unwrap();
        assert_eq!(band.years, 3);
        assert_eq!((band.low, band.high), (60.0, 80.0));
        assert_eq!(band.mean, 70.0);
    }

    #[test]
    fn seasonal_band_needs_two_years_and_handles_leap_day() {
        let series = vec![(day(2025, 2, 27), 1.0)];
        assert_eq!(seasonal_band(&series, day(2028, 2, 29), 3, 5), None);
        let two = vec![(day(2025, 2, 27), 1.0), (day(2024, 2, 29), 3.0)];
        assert_eq!(
            seasonal_band(&two, day(2028, 2, 29), 4, 3).unwrap().years,
            2
        );
    }
}
