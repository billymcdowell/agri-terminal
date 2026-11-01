import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type PriceBar = {
  seriesId: string;
  period: string;
  releasedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  unit: string;
  sourceId: string;
  fetchedAt: string;
  revision: number;
};

export type SourceStatus = {
  sourceId: string;
  name: string;
  state: string;
  lastOk: string | null;
  error: string | null;
  isDemo: boolean;
  lastAttempt: string | null;
  nextExpected: string | null;
  enabled: boolean;
  cadenceSeconds: number;
};

export type MetricPoint = {
  seriesId: string; period: string; releasedAt: string; value: number; unit: string;
  sourceId: string; fetchedAt: string; revision: number;
};
export type CalendarEvent = { id: string; kind: string; scheduledAt: string; commodity: string | null; title: string };
export type WeatherForecast = { regionId: string; regionName: string; latitude: number; longitude: number; provider: string; validAt: string; temperatureC: number | null; precipitationMm: number | null; precipitationProbability: number | null; windKph: number | null; relativeHumidity: number | null; summary: string };
export type WeatherSnapshot = { fetchedAt: string | null; forecasts: WeatherForecast[] };
export type NewsItem = { title: string; source: string; publishedAt: string; url: string; commodity: string };

export function getSeries(seriesId: string) {
  return invoke<PriceBar[]>("get_series", { seriesId });
}

export function listSources() {
  return invoke<SourceStatus[]>("list_sources");
}

export function getMetricSeries(seriesId: string) { return invoke<MetricPoint[]>("get_metric_series", { seriesId }); }
export function listCalendarEvents() { return invoke<CalendarEvent[]>("list_calendar_events"); }
export function getWeatherForCommodity(commodity: string) { return invoke<WeatherSnapshot>("get_weather_for_commodity", { commodity }); }
export function refreshWeather(commodity: string) { return invoke<void>("refresh_weather", { commodity }); }
export function getNewsForCommodity(commodity: string) { return invoke<NewsItem[]>("get_news_for_commodity", { commodity }); }
export function refreshNews(commodity: string) { return invoke<void>("refresh_news", { commodity }); }
export function saveSecret(id: string, value: string) { return invoke<void>("save_secret", { id, value }); }
export function getSecretStatus(id: string) { return invoke<boolean>("get_secret_status", { id }); }
export function testConnection(sourceId: string) { return invoke<void>("test_connection", { sourceId }); }
export function setSourceEnabled(sourceId: string, enabled: boolean) { return invoke<void>("set_source_enabled", { sourceId, enabled }); }

export function refreshSource(sourceId: string) {
  return invoke<void>("refresh_source", { sourceId });
}

export type PriceMove = { date: string; previousDate: string; logReturn: number; zScore: number };
export type Driver = { kind: "scheduled_event" | "news" | "river_event"; title: string; url: string | null; source: string; at: string; label: string; score: number; reasons: string[] };
export type MoveExplanation = { move: PriceMove; label: string; drivers: Driver[] };
export type StressPoint = { date: string; close: number; condition: number | null; conditionLow: number | null; conditionHigh: number | null; drought: number | null };
export type BacktestReport = { total: number; detected: number; topMatch: number; missedDates: string[]; topMatchRate: number | null };

export type RiverThresholds = { normal: number; restriction: number; critical: number };
/** The latest value of one river input and when it was published and fetched. */
export type RiverInput = { period: string; value: number; releasedAt: string; fetchedAt: string; sourceId: string };
export type SeasonalBand = { low: number; mean: number; high: number; years: number };
export type ScoreComponent = { value: number; weight: number; points: number };
export type RiverBand = "NORMAL" | "ELEVATED" | "HIGH";
export type ConstraintScore = { total: number; band: RiverBand; depth: ScoreComponent | null; forecast: ScoreComponent | null; traffic: ScoreComponent | null; partial: boolean };
export type BargeRateStatus = { latest: RiverInput; dollarsPerTon: number | null; previous: RiverInput | null; changePercent: number | null; location: string };
/** How far the barge rate moved per foot of change in depth below the restriction level, over `horizonWeeks`. */
export type Sensitivity = { beta: number; intercept: number; rSquared: number; pairs: number; depthChangePairs: number; horizonWeeks: number };
/** The barge-rate change implied if the river follows the forecast for two weeks, in percent of tariff. */
export type ExpectedPressure = { currentDepth: number; expectedDepth: number; change: number; dollarsPerTon: number | null; sensitivity: Sensitivity };
export type TrafficStatus = { week: string; tons: number; averageTons: number; changePercent: number; locks: string[]; releasedAt: string };
export type RiverStatus = {
  gaugeId: string; gaugeName: string; riverName: string; unit: string; thresholds: RiverThresholds; provisional: boolean; asOf: string;
  stage: RiverInput | null; stageBand: SeasonalBand | null;
  forecastIssuedAt: string | null; forecastFetchedAt: string | null; forecast: { date: string; low: number }[]; forecastMin: number | null; restrictionForecastOn: string | null;
  bargeRate: BargeRateStatus | null; traffic: TrafficStatus | null; score: ConstraintScore | null; pressure: ExpectedPressure | null;
};
/** One day of the river timeline, as known at that day's close. `bargeRate` is percent of the 1976 tariff. */
export type RiverPoint = {
  date: string; close: number | null; stage: number | null; stageLow: number | null; stageMean: number | null; stageHigh: number | null;
  forecastMin: number | null; bargeRate: number | null; score: number | null; band: RiverBand | null; partial: boolean; basisSpread: number | null;
};
export type FreightEpisode = { start: string; risePercent: number; stage: number | null; warnedDaysBefore: number | null };
/** River alerts replayed over a gauge's stored history against weeks barge freight rose 25% or more. */
export type GaugeBacktest = {
  gaugeId: string; gaugeName: string; from: string | null; to: string | null; episodes: FreightEpisode[]; warnedEpisodes: number;
  alerts: number; alertsPerYear: number; warnings: number; warningsFollowed: number;
};
export function runRiverBacktest() { return invoke<GaugeBacktest[]>("run_river_backtest"); }
export function getRiverStatus(gauge?: string) { return invoke<RiverStatus>("get_river_status", { gauge }); }
export function getRiverTimeline(gauge: string | undefined, commodity: string) { return invoke<RiverPoint[]>("get_river_timeline", { gauge, commodity }); }

export function explainMoves(commodity: string, thresholdSd?: number) { return invoke<MoveExplanation[]>("explain_moves", { commodity, thresholdSd }); }
export function cropStressTimeline(commodity: string) { return invoke<StressPoint[]>("crop_stress_timeline", { commodity }); }
export function runBacktest() { return invoke<BacktestReport>("run_backtest"); }
export function getSetting(key: string) { return invoke<string | null>("get_setting", { key }); }
export function setSetting(key: string, value: string) { return invoke<void>("set_setting", { key, value }); }

export type PriceAlert = { id: string; symbol: string; direction: "above" | "below"; threshold: number };
export type AlertRecord = PriceAlert & { enabled: boolean; triggered: boolean };
/** A crossing that fired an alert, with prices in USD per bushel. */
export type AlertFired = PriceAlert & { close: number; date: string };
export function listAlerts() { return invoke<AlertRecord[]>("list_alerts"); }
export function saveAlert(alert: PriceAlert) { return invoke<void>("save_alert", { alert }); }
export function deleteAlert(id: string) { return invoke<void>("delete_alert", { id }); }
export function setAlertEnabled(id: string, enabled: boolean) { return invoke<void>("set_alert_enabled", { id, enabled }); }
export function subscribeToAlerts(callback: (alert: AlertFired) => void) {
  return listen<AlertFired>("alert-fired", (event) => callback(event.payload));
}

export type RiverRule = "below_restriction" | "below_critical" | "forecast_restriction" | "band_up";
/** A built-in river alert. `state` is 1 while its condition holds, or the band reached (0 normal, 1 elevated, 2 high) for band_up. */
export type RiverAlertRecord = { id: string; gaugeId: string; gaugeName: string; rule: RiverRule; description: string; enabled: boolean; state: number };
export type RiverAlertFired = { id: string; gaugeId: string; rule: RiverRule; title: string; body: string; date: string };
export function listRiverAlerts() { return invoke<RiverAlertRecord[]>("list_river_alerts"); }
export function setRiverAlertEnabled(id: string, enabled: boolean) { return invoke<void>("set_river_alert_enabled", { id, enabled }); }
export function subscribeToRiverAlerts(callback: (alert: RiverAlertFired) => void) {
  return listen<RiverAlertFired>("river-alert-fired", (event) => callback(event.payload));
}

export function getDataDirectory() { return invoke<string>("get_data_directory"); }
export function listSeries() { return invoke<string[]>("list_series"); }
/** A stored series and the source that wrote it; `rows` counts every revision. */
export type StoredSeries = { seriesId: string; sourceId: string; kind: "price" | "metric"; rows: number; firstPeriod: string; lastPeriod: string; lastFetchedAt: string };
export type StoredRows = { kind: "price"; rows: PriceBar[] } | { kind: "metric"; rows: MetricPoint[] };
export function listStoredSeries() { return invoke<StoredSeries[]>("list_stored_series"); }
export function getStoredRows(seriesId: string) { return invoke<StoredRows>("get_stored_rows", { seriesId }); }
export function exportSeriesCsv(seriesId: string) { return invoke<string>("export_series_csv", { seriesId }); }
export function exportWorkspace(id: string) { return invoke<string>("export_workspace", { id }); }

export type PluginSecret = { name: string; configured: boolean };
export type PluginSummary = { id: string; name: string; version: string; description: string; licenseNote: string; builtin: boolean; hosts: string[]; secrets: PluginSecret[]; series: string[]; cadence: string; errors: string[] };
export type PluginPreview = { errors: string[]; summary: PluginSummary | null };
export function listPlugins() { return invoke<PluginSummary[]>("list_plugins"); }
export function previewPlugin(manifest: string) { return invoke<PluginPreview>("preview_plugin", { manifest }); }
export function installPlugin(manifest: string) { return invoke<PluginSummary>("install_plugin", { manifest }); }
export function removePlugin(id: string) { return invoke<void>("remove_plugin", { id }); }
export function savePluginSecret(pluginId: string, name: string, value: string) { return invoke<void>("save_plugin_secret", { pluginId, name, value }); }

export type SavedWorkspace = [id: string, name: string, json: string];
export function listWorkspaces() { return invoke<SavedWorkspace[]>("list_workspaces"); }
export function saveWorkspace(id: string, name: string, json: string) { return invoke<void>("save_workspace", { id, name, json }); }
export function deleteWorkspace(id: string) { return invoke<void>("delete_workspace", { id }); }

export function subscribeToDataUpdates(
  callback: (seriesIds: string[]) => void,
) {
  return listen<string[]>("data-updated", (event) => callback(event.payload));
}

export function subscribeToSourceStatus(callback: (status: string) => void) {
  return listen<string>("source-status", (event) => callback(event.payload));
}
