use std::time::Duration;

use tauri::AppHandle;

use crate::{commands, sources::databento};

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let cadence = Duration::from_secs(24 * 60 * 60);
        let first_run = tokio::time::Instant::now() + cadence;
        let mut interval = tokio::time::interval_at(first_run, cadence);

        loop {
            interval.tick().await;
            if !databento::has_api_key() {
                continue;
            }
            if let Err(error) = commands::refresh_source(app.clone(), "databento".into()).await {
                tracing::warn!(%error, "Scheduled Databento refresh failed");
            }
        }
    });
}
