import type { SourceStatus, StoredSeries } from "@/lib/ipc";

export type RawDataset = { id: string; label: string; rows: number; lastFetchedAt: string | null };
/** Scheduled sources write series; weather and news are cached per commodity instead. */
export type RawSourceKind = "series" | "weather" | "news";
export type RawSource = { id: string; name: string; kind: RawSourceKind; status?: SourceStatus; datasets: RawDataset[] };

/** Registered sources in status order, then any source whose rows outlived its registration, then the weather and news caches. */
export function buildRawSources(sources: SourceStatus[], stored: StoredSeries[], caches: { weather: RawDataset[]; news: RawDataset[] }): RawSource[] {
  const datasetsOf = (sourceId: string) => stored
    .filter((series) => series.sourceId === sourceId)
    .map((series) => ({ id: series.seriesId, label: series.seriesId, rows: series.rows, lastFetchedAt: series.lastFetchedAt }));
  const registered = sources.map((status): RawSource => ({ id: status.sourceId, name: status.name, kind: "series", status, datasets: datasetsOf(status.sourceId) }));
  const orphaned = [...new Set(stored.map((series) => series.sourceId))]
    .filter((id) => !sources.some((status) => status.sourceId === id))
    .map((id): RawSource => ({ id, name: id, kind: "series", datasets: datasetsOf(id) }));
  return [
    ...registered,
    ...orphaned,
    { id: "weather", name: "Weather · NWS and Open-Meteo", kind: "weather", datasets: caches.weather },
    { id: "news", name: "News · GDELT and USDA RSS", kind: "news", datasets: caches.news },
  ];
}

export function totalRows(source: RawSource) {
  return source.datasets.reduce((sum, dataset) => sum + dataset.rows, 0);
}

/** The source's last successful refresh, else the newest row it wrote. */
export function lastRefresh(source: RawSource): string | null {
  if (source.status?.lastOk) return source.status.lastOk;
  return source.datasets.reduce<string | null>((latest, dataset) => {
    if (!dataset.lastFetchedAt) return latest;
    return !latest || Date.parse(dataset.lastFetchedAt) > Date.parse(latest) ? dataset.lastFetchedAt : latest;
  }, null);
}

/** Every key that appears in the rows, in first-seen order, except ones the panel already shows above the table. */
export function rawColumns(rows: object[], omit: readonly string[] = []): string[] {
  const columns = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) if (!omit.includes(key)) columns.add(key);
  return [...columns];
}

/** Values exactly as stored: no unit conversion, rounding or date formatting. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
