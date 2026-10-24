use chrono::NaiveDate;
use serde::Serialize;

#[derive(Clone, Copy, Debug)]
pub struct PricePoint {
    pub date: NaiveDate,
    pub close: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceMove {
    pub date: NaiveDate,
    pub previous_date: NaiveDate,
    pub log_return: f64,
    /// The return in units of the standard deviation of the preceding window's returns.
    pub z_score: f64,
}

pub const DEFAULT_WINDOW: usize = 20;
pub const DEFAULT_THRESHOLD_SD: f64 = 2.0;

fn sample_std(values: &[f64]) -> f64 {
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    (values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (values.len() - 1) as f64)
        .sqrt()
}

/// Flags days whose log return is beyond `threshold_sd` standard deviations of the `window`
/// returns before it. The current day is left out of its own baseline, so one spike cannot
/// hide itself by inflating the volatility estimate.
pub fn detect_moves(closes: &[PricePoint], window: usize, threshold_sd: f64) -> Vec<PriceMove> {
    if window < 2 || closes.len() <= window + 1 {
        return Vec::new();
    }
    let returns: Vec<f64> = closes
        .windows(2)
        .map(|pair| (pair[1].close / pair[0].close).ln())
        .collect();
    (window..returns.len())
        .filter_map(|index| {
            let baseline = sample_std(&returns[index - window..index]);
            if !baseline.is_finite() || baseline == 0.0 {
                return None;
            }
            let z_score = returns[index] / baseline;
            (z_score.abs() >= threshold_sd).then(|| PriceMove {
                date: closes[index + 1].date,
                previous_date: closes[index].date,
                log_return: returns[index],
                z_score,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A quiet, mildly noisy series with known spikes injected on chosen days.
    fn series(spikes: &[(usize, f64)]) -> Vec<PricePoint> {
        let mut price = 4.0_f64;
        let start = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        (0..80)
            .map(|day| {
                let noise = if day % 2 == 0 { 0.002 } else { -0.0015 };
                let shock = spikes
                    .iter()
                    .find(|(index, _)| *index == day)
                    .map_or(0.0, |(_, size)| *size);
                price *= (noise + shock).exp();
                PricePoint {
                    date: start + chrono::Duration::days(day as i64),
                    close: price,
                }
            })
            .collect()
    }

    #[test]
    fn flags_only_the_injected_spikes() {
        let moves = detect_moves(
            &series(&[(25, 0.05), (60, -0.04)]),
            DEFAULT_WINDOW,
            DEFAULT_THRESHOLD_SD,
        );
        let dates: Vec<_> = moves.iter().map(|item| item.date).collect();
        let start = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        assert_eq!(
            dates,
            vec![
                start + chrono::Duration::days(25),
                start + chrono::Duration::days(60)
            ]
        );
        assert!(moves[0].log_return > 0.0 && moves[1].log_return < 0.0);
        assert!(moves[0].z_score > 2.0 && moves[1].z_score < -2.0);
    }

    #[test]
    fn a_higher_threshold_flags_fewer_moves() {
        let data = series(&[(25, 0.05), (60, -0.006)]);
        assert_eq!(detect_moves(&data, DEFAULT_WINDOW, 2.0).len(), 2);
        assert_eq!(detect_moves(&data, DEFAULT_WINDOW, 6.0).len(), 1);
    }

    #[test]
    fn short_or_flat_series_flag_nothing() {
        assert!(detect_moves(&series(&[])[..10], DEFAULT_WINDOW, 2.0).is_empty());
        let flat: Vec<_> = (0..40)
            .map(|day| PricePoint {
                date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap() + chrono::Duration::days(day),
                close: 4.0,
            })
            .collect();
        assert!(detect_moves(&flat, DEFAULT_WINDOW, 2.0).is_empty());
    }
}
