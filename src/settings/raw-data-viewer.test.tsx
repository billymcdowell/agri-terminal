// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  listSources: vi.fn(), listStoredSeries: vi.fn(), getStoredRows: vi.fn(), getWeatherForCommodity: vi.fn(), getNewsForCommodity: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  ...ipc,
  subscribeToSourceStatus: () => Promise.resolve(() => undefined),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
}));

import { RawDataViewer } from "./raw-data-viewer";

const bar = (period: string, revision: number, close: number) => ({
  seriesId: "price.ZC.close", period, releasedAt: `${period}T20:00:00+00:00`, open: close - 0.05, high: close + 0.1, low: close - 0.1, close,
  unit: "USD/bushel", sourceId: "databento", fetchedAt: `${period}T21:00:00+00:00`, revision,
});

function renderViewer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><RawDataViewer /></QueryClientProvider>);
}

describe("RawDataViewer", () => {
  beforeEach(() => {
    ipc.listSources.mockResolvedValue([
      { sourceId: "databento", name: "Databento · GLBX.MDP3", state: "ok", lastOk: null, error: null, enabled: true },
      { sourceId: "usda-nass", name: "USDA NASS QuickStats", state: "error", lastOk: null, error: "Authentication is required or was rejected", enabled: true },
    ]);
    ipc.listStoredSeries.mockResolvedValue([
      { seriesId: "price.ZC.close", sourceId: "databento", kind: "price", rows: 3, firstPeriod: "2026-10-20", lastPeriod: "2026-10-21", lastFetchedAt: "2026-10-21T21:00:00+00:00" },
    ]);
    ipc.getStoredRows.mockResolvedValue({ kind: "price", rows: [bar("2026-10-20", 0, 4.52), bar("2026-10-20", 1, 4.61), bar("2026-10-21", 0, 4.7)] });
    ipc.getWeatherForCommodity.mockResolvedValue({ fetchedAt: null, forecasts: [] });
    ipc.getNewsForCommodity.mockResolvedValue([]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("opens on the first source with rows and shows every revision, newest period first", async () => {
    renderViewer();
    expect(await screen.findByText("4.61")).toBeTruthy();
    expect(ipc.getStoredRows).toHaveBeenCalledWith("price.ZC.close");
    const rows = screen.getAllByRole("row").filter((row) => within(row).queryByText("USD/bushel"));
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["2026-10-21", "2026-10-20", "2026-10-20"]);
    // The series and source are named above the table, not repeated on every row.
    expect(screen.queryByRole("columnheader", { name: "seriesId" })).toBeNull();
  });

  it("shows the stored rows as JSON", async () => {
    renderViewer();
    await screen.findByText("4.61");
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.getByText(/"close": 4.7/)).toBeTruthy();
  });

  it("switches source and explains an empty or failing one", async () => {
    renderViewer();
    await screen.findByText("4.61");
    fireEvent.click(screen.getByRole("button", { name: "USDA NASS QuickStats" }));
    expect(await screen.findByText(/Last refresh failed · Authentication/)).toBeTruthy();
    expect(screen.getByText(/Nothing stored from this source yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Databento · GLBX.MDP3" }));
    expect(await screen.findByText("4.61")).toBeTruthy();
  });
});
