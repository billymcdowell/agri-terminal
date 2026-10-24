use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::util::SubscriberInitExt;

pub struct LoggingState(pub std::sync::Mutex<WorkerGuard>);

pub fn initialize(log_directory: &Path) -> Result<WorkerGuard, String> {
    std::fs::create_dir_all(log_directory)
        .map_err(|error| format!("Create application log directory: {error}"))?;
    let appender = tracing_appender::rolling::daily(log_directory, "agri-terminal.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_target(false)
        .try_init()
        .map_err(|error| format!("Initialize application logger: {error}"))?;
    Ok(guard)
}
