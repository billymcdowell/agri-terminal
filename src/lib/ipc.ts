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
export type Driver = { kind: "scheduled_event" | "news"; title: string; url: string | null; source: string; at: string; label: string; score: number; reasons: string[] };
export type MoveExplanation = { move: PriceMove; label: string; drivers: Driver[] };
export type StressPoint = { date: string; close: number; condition: number | null; conditionLow: number | null; conditionHigh: number | null; drought: number | null };
export type BacktestReport = { total: number; detected: number; topMatch: number; missedDates: string[]; topMatchRate: number | null };

export function explainMoves(commodity: string, thresholdSd?: number) { return invoke<MoveExplanation[]>("explain_moves", { commodity, thresholdSd }); }
export function cropStressTimeline(commodity: string) { return invoke<StressPoint[]>("crop_stress_timeline", { commodity }); }
export function runBacktest() { return invoke<BacktestReport>("run_backtest"); }
export function getSetting(key: string) { return invoke<string | null>("get_setting", { key }); }
export function setSetting(key: string, value: string) { return invoke<void>("set_setting", { key, value }); }

export type SavedWorkspace = [id: string, name: string, json: string];
export function listWorkspaces() { return invoke<SavedWorkspace[]>("list_workspaces"); }
export function saveWorkspace(id: string, name: string, json: string) { return invoke<void>("save_workspace", { id, name, json }); }

export function saveDatabentoKey(key: string) {
  return invoke<void>("save_databento_key", { key });
}

export function getDatabentoKeyStatus() {
  return invoke<boolean>("get_databento_key_status");
}

export function subscribeToDataUpdates(
  callback: (seriesIds: string[]) => void,
) {
  return listen<string[]>("data-updated", (event) => callback(event.payload));
}

export function subscribeToSourceStatus(callback: (status: string) => void) {
  return listen<string>("source-status", (event) => callback(event.payload));
}
