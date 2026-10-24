// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricPoint, SourceStatus } from "@/lib/ipc";

const ipc = vi.hoisted(() => ({
  getMetricSeries: vi.fn(),
  listSources: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  getMetricSeries: ipc.getMetricSeries,
  listSources: ipc.listSources,
  subscribeToSourceStatus: () => Promise.resolve(() => undefined),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
}));

import { MetricPanel } from "./metric-panel";

const point = (period: string, value: number, fetchedAt: string): MetricPoint => ({
  seriesId: "cot.ZC.managed_money_net", period, releasedAt: fetchedAt, value, unit: "contracts", sourceId: "cftc-cot", fetchedAt, revision: 0,
});
const source = (patch: Partial<SourceStatus>): SourceStatus => ({
  sourceId: "cftc-cot", name: "CFTC Commitments of Traders", state: "ok", lastOk: new Date().toISOString(), error: null,
  isDemo: false, lastAttempt: null, nextExpected: null, enabled: true, cadenceSeconds: 604_800, ...patch,
});

function renderPanel(kind = "cot") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = { setTitle: vi.fn(), updateParameters: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <MetricPanel api={api} params={{ kind, commodity: "ZC" }} />
    </QueryClientProvider>,
  );
}

describe("MetricPanel", () => {
  beforeEach(() => {
    ipc.getMetricSeries.mockImplementation(async (seriesId: string) =>
      seriesId === "cot.ZC.managed_money_net"
        ? [point("2026-10-06", -20, "2026-10-09T20:00:00Z"), point("2026-10-13", 10, "2026-10-16T20:00:00Z"), point("2026-10-20", 40, "2026-10-23T20:00:00Z")]
        : []);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("shows the latest value, its historical percentile and an OK freshness label", async () => {
    ipc.listSources.mockResolvedValue([source({})]);
    renderPanel();
    expect(await screen.findByText("40 contracts")).toBeTruthy();
    expect(screen.getByText("100th")).toBeTruthy();
    expect((await screen.findByText(/^OK ·/)).textContent).toContain("CFTC Commitments of Traders");
  });

  it("keeps showing cached values with an error label when the source is failing", async () => {
    ipc.listSources.mockResolvedValue([source({ state: "error", error: "CFTC request failed" })]);
    renderPanel();
    expect(await screen.findByText("40 contracts")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/ERROR · CACHED OBSERVATIONS/).textContent).toContain("CFTC request failed"));
  });

  it("labels a source that has not refreshed within 1.5 cadences as stale", async () => {
    ipc.listSources.mockResolvedValue([source({ lastOk: new Date(Date.now() - 20 * 86_400_000).toISOString() })]);
    renderPanel();
    expect(await screen.findByText(/^STALE ·/)).toBeTruthy();
  });

  it("reports rows with no cached data rather than inventing values", async () => {
    ipc.listSources.mockResolvedValue([source({})]);
    renderPanel();
    expect(await screen.findByText("40 contracts")).toBeTruthy();
    expect(screen.getAllByText("No cached data")).toHaveLength(2);
  });
});
