// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceStatus } from "@/lib/ipc";

const ipc = vi.hoisted(() => ({
  listSources: vi.fn(), listPlugins: vi.fn(async () => []), getSecretStatus: vi.fn(async () => true),
}));
vi.mock("@/lib/ipc", () => ({
  ...ipc,
  subscribeToSourceStatus: () => Promise.resolve(() => undefined),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
}));

import { DataSources } from "@/settings/data-sources";
import { useSettingsScreen } from "@/settings/use-settings-screen";
import { AttentionIndicator } from "./attention";
import { useNavigation } from "./navigation";

const source = (patch: Partial<SourceStatus>): SourceStatus => ({
  sourceId: "cftc-cot", name: "CFTC Commitments of Traders", state: "ok", lastOk: new Date(Date.now() - 2 * 3_600_000).toISOString(), error: null,
  isDemo: false, lastAttempt: null, nextExpected: null, enabled: true, cadenceSeconds: 604_800, ...patch,
});
const withClient = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

describe("AttentionIndicator", () => {
  beforeEach(() => useSettingsScreen.setState({ section: "general", problemsOnly: false }));
  afterEach(() => { cleanup(); vi.clearAllMocks(); useNavigation.setState({ page: "market" }); });

  it("shows nothing while every source is fine", async () => {
    ipc.listSources.mockResolvedValue([source({}), source({ sourceId: "usda-fas", name: "USDA FAS", enabled: false, state: "error" })]);
    withClient(<AttentionIndicator />);
    await waitFor(() => expect(ipc.listSources).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts failing and out-of-date sources, and opens Data sources at just those", async () => {
    ipc.listSources.mockResolvedValue([
      source({ sourceId: "usda-nass", name: "USDA NASS", state: "error", error: "Bad key" }),
      source({ sourceId: "usda-fas", name: "USDA FAS", lastOk: "2026-01-01T00:00:00Z" }),
      source({}),
    ]);
    withClient(<AttentionIndicator />);
    fireEvent.click(await screen.findByRole("button", { name: "2 data sources need attention" }));
    expect(useNavigation.getState().page).toBe("settings");
    expect(useSettingsScreen.getState()).toMatchObject({ section: "sources", problemsOnly: true });
    cleanup();

    withClient(<DataSources />);
    expect(await screen.findByText("These 2 sources are failing or out of date.")).toBeTruthy();
    expect(screen.getByText("USDA NASS")).toBeTruthy();
    expect(screen.queryByText("CFTC Commitments of Traders")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all sources" }));
    expect(await screen.findByText("CFTC Commitments of Traders")).toBeTruthy();
  });
});
