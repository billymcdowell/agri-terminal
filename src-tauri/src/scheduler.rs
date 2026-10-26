use chrono::{DateTime, Duration as ChronoDuration, Utc};
use std::time::Duration;
use tauri::AppHandle;

use crate::{commands, sources::fundamentals};

pub fn retry_deadline(
    now: DateTime<Utc>,
    attempts: u32,
    cadence_seconds: i64,
    retry_after: Option<DateTime<Utc>>,
    jitter_seed: u64,
) -> DateTime<Utc> {
    let exponent = attempts.clamp(1, 6);
    let base = cadence_seconds
        .saturating_mul(1_i64 << exponent)
        .min(604_800);
    let jitter_window = (base / 10).max(1) as u64;
    let jitter = (jitter_seed % jitter_window) as i64;
    let backoff = now + ChronoDuration::seconds((base - jitter).max(1));
    retry_after.map_or(backoff, |server_time| server_time.max(backoff))
}

fn source_is_configured(app: &AppHandle, id: &str) -> bool {
    match id {
        "massive" | "usda-nass" | "usda-fas" => fundamentals::has_secret(id),
        "fixture-corn" => false,
        _ => commands::plugin_is_configured(app, id),
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let due = match commands::due_sources(&app) {
                Ok(due) => due,
                Err(error) => {
                    tracing::error!(%error, "Could not load due data sources");
                    continue;
                }
            };
            for source_id in due.into_iter().filter(|id| source_is_configured(&app, id)) {
                if let Err(error) = commands::refresh_source(app.clone(), source_id.clone()).await {
                    tracing::warn!(source = %source_id, %error, "Scheduled source refresh failed");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_grows_and_caps_with_deterministic_jitter() {
        let now = DateTime::parse_from_rfc3339("2026-10-24T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let first = retry_deadline(now, 1, 86_400, None, 0);
        let second = retry_deadline(now, 2, 86_400, None, 0);
        let capped = retry_deadline(now, 6, 604_800, None, 0);
        assert!(second > first);
        assert_eq!((capped - now).num_seconds(), 604_800);
        assert!(retry_deadline(now, 1, 86_400, None, 4) < first);
    }

    #[test]
    fn server_retry_after_is_respected_when_later_than_backoff() {
        let now = DateTime::parse_from_rfc3339("2026-10-24T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let retry_after = now + ChronoDuration::days(3);
        assert_eq!(
            retry_deadline(now, 1, 86_400, Some(retry_after), 0),
            retry_after
        );
    }
}
