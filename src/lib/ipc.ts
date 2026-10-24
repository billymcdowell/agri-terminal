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
};

export function getSeries(seriesId: string) {
  return invoke<PriceBar[]>("get_series", { seriesId });
}

export function listSources() {
  return invoke<SourceStatus[]>("list_sources");
}

export function refreshSource(sourceId: string) {
  return invoke<void>("refresh_source", { sourceId });
}

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
