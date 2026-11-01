// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PriceBar, SourceStatus } from "@/lib/ipc";

const ipc = vi.hoisted(() => ({
  getSeries: vi.fn(),
  listSources: vi.fn(),
  getSecretStatus: vi.fn(),
  explainMoves: vi.fn(async () => []),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(),
  refreshSource: vi.fn(),
  saveSecret: vi.fn(),
  setSourceEnabled: vi.fn(),
  testConnection: vi.fn(),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
  subscribeToSourceStatus: () => Promise.resolve(() => undefined),
}));
vi.mock("@/lib/ipc", () => ipc);
// The canvas chart needs a browser layout engine; these tests cover what surrounds it.
vi.mock("@/panels/price-chart", () => ({ PriceChart: () => <div data-testid="price-chart" /> }));
vi.mock("@/workspace/shell", () => ({ WorkspaceShell: () => null }));

import { MarketOverview } from "./App";

const bar = (period: string, close: number, sourceId: string): PriceBar => ({
  seriesId: "price.ZC.close", period, releasedAt: `${period}T20:00:00Z`, open: close, high: close, low: close, close,
  unit: "USD/bushel", sourceId, fetchedAt: new Date().toISOString(), revision: 0,
});
const massive: SourceStatus = {
  sourceId: "massive", name: "Massive futures", state: "ok", lastOk: new Date().toISOString(), error: null,
  isDemo: false, lastAttempt: null, nextExpected: null, enabled: true, cadenceSeconds: 86_400,
};

function renderMarket(commodity = "ZC") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MarketOverview commodity={commodity} /></QueryClientProvider>);
}

describe("MarketOverview", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("shows the price, its change and one freshness line for market data", async () => {
    ipc.getSeries.mockResolvedValue([bar("2026-10-29", 4.65, "massive"), bar("2026-10-30", 4.55, "massive")]);
    ipc.listSources.mockResolvedValue([massive]);
    ipc.getSecretStatus.mockResolvedValue(true);
    renderMarket();
    expect(await screen.findByText("$4.55")).toBeTruthy();
    expect(screen.getAllByText(/4\.55/)).toHaveLength(1);
    expect(screen.getByText("-0.10 (-2.15%)").dataset.direction).toBe("down");
    expect(screen.getByText((_, element) => element?.tagName === "SPAN" && /^OK · .+ · Massive$/.test(element.textContent ?? ""))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Data sources" })).toBeTruthy();
    expect(screen.queryByText(/sample corn prices/)).toBeNull();
  });

  it("labels the sample series with a banner instead of a freshness line", async () => {
    ipc.getSeries.mockResolvedValue([bar("2026-10-29", 4.5, "fixture-corn"), bar("2026-10-30", 4.6, "fixture-corn")]);
    ipc.listSources.mockResolvedValue([massive]);
    ipc.getSecretStatus.mockResolvedValue(false);
    renderMarket();
    expect(await screen.findByText(/Showing sample corn prices, not market quotes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add key" })).toBeTruthy();
    expect(screen.queryByText(/^OK ·/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Data sources" })).toBeNull();
  });

  it("asks for a key when a crop has no prices and no sample series", async () => {
    ipc.getSeries.mockResolvedValue([]);
    ipc.listSources.mockResolvedValue([massive]);
    ipc.getSecretStatus.mockResolvedValue(false);
    renderMarket("ZS");
    expect(await screen.findByText("No soybeans prices yet")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Add a Massive key" })).toBeTruthy();
  });
});
