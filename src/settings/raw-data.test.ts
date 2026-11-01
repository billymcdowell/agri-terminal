import { describe, expect, it } from "vitest";
import type { SourceStatus, StoredSeries } from "@/lib/ipc";
import { buildRawSources, formatCell, lastRefresh, rawColumns, totalRows } from "./raw-data";

const status = (patch: Partial<SourceStatus>): SourceStatus => ({
  sourceId: "cftc-cot", name: "CFTC Commitments of Traders", state: "ok", lastOk: null, error: null, isDemo: false,
  lastAttempt: null, nextExpected: null, enabled: true, cadenceSeconds: 604_800, ...patch,
});
const series = (patch: Partial<StoredSeries>): StoredSeries => ({
  seriesId: "cot.ZC.managed_money_net", sourceId: "cftc-cot", kind: "metric", rows: 3,
  firstPeriod: "2026-10-06", lastPeriod: "2026-10-20", lastFetchedAt: "2026-10-24T12:00:00+00:00", ...patch,
});
const noCaches = { weather: [], news: [] };

describe("buildRawSources", () => {
  it("groups stored series under the source that wrote them", () => {
    const [cot, nass] = buildRawSources(
      [status({}), status({ sourceId: "usda-nass", name: "USDA NASS QuickStats" })],
      [series({}), series({ seriesId: "cot.ZS.managed_money_net", rows: 2 })],
      noCaches,
    );
    expect(cot.datasets.map((dataset) => dataset.id)).toEqual(["cot.ZC.managed_money_net", "cot.ZS.managed_money_net"]);
    expect(totalRows(cot)).toBe(5);
    expect(nass.datasets).toEqual([]);
  });

  it("keeps rows from a source that is no longer registered", () => {
    const sources = buildRawSources([status({})], [series({ sourceId: "removed-plugin", seriesId: "plugin.x" })], noCaches);
    expect(sources.map((source) => [source.id, source.status?.sourceId])).toEqual([
      ["cftc-cot", "cftc-cot"], ["removed-plugin", undefined], ["weather", undefined], ["news", undefined],
    ]);
  });
});

describe("lastRefresh", () => {
  it("prefers the source's last successful refresh over row fetch times", () => {
    const [cot] = buildRawSources([status({ lastOk: "2026-10-25T08:00:00Z" })], [series({})], noCaches);
    expect(lastRefresh(cot)).toBe("2026-10-25T08:00:00Z");
  });
  it("falls back to the newest row", () => {
    const sources = buildRawSources([], [], { weather: [
      { id: "ZC", label: "ZC", rows: 4, lastFetchedAt: "2026-10-24T01:00:00Z" },
      { id: "ZS", label: "ZS", rows: 4, lastFetchedAt: "2026-10-24T09:00:00Z" },
      { id: "ZW", label: "ZW", rows: 0, lastFetchedAt: null },
    ], news: [] });
    expect(lastRefresh(sources[0])).toBe("2026-10-24T09:00:00Z");
    expect(lastRefresh(sources[1])).toBeNull();
  });
});

describe("rawColumns and formatCell", () => {
  it("lists every key once, minus the omitted ones", () => {
    expect(rawColumns([{ seriesId: "a", period: "p", value: 1 }, { seriesId: "a", period: "q", extra: true }], ["seriesId"])).toEqual(["period", "value", "extra"]);
  });
  it("shows values as stored", () => {
    expect([formatCell(null), formatCell(4.5225), formatCell("2026-10-20T20:00:00+00:00"), formatCell({ a: 1 })]).toEqual(["null", "4.5225", "2026-10-20T20:00:00+00:00", '{"a":1}']);
  });
});
