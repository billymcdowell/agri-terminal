// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary, SourceStatus } from "@/lib/ipc";

const ipc = vi.hoisted(() => ({
  listSources: vi.fn(), listPlugins: vi.fn(), getSecretStatus: vi.fn(), saveSecret: vi.fn(), savePluginSecret: vi.fn(),
  refreshSource: vi.fn(), testConnection: vi.fn(), setSourceEnabled: vi.fn(), previewPlugin: vi.fn(), installPlugin: vi.fn(), removePlugin: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  ...ipc,
  subscribeToSourceStatus: () => Promise.resolve(() => undefined),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
}));

import { DataSources, sourceRows, sourceStatus } from "./data-sources";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const source = (patch: Partial<SourceStatus>): SourceStatus => ({
  sourceId: "cftc-cot", name: "CFTC Commitments of Traders", state: "ok", lastOk: new Date(Date.now() - 2 * 3_600_000).toISOString(), error: null,
  isDemo: false, lastAttempt: null, nextExpected: null, enabled: true, cadenceSeconds: 604_800, ...patch,
});
const plugin = (patch: Partial<PluginSummary>): PluginSummary => ({
  id: "example-weather", name: "Example weather", version: "1.0.0", description: "", licenseNote: "", builtin: false,
  hosts: ["api.example.com"], secrets: [{ name: "token", configured: false }], series: ["plugin.example-weather.temp"], cadence: "daily", errors: [], ...patch,
});

function renderSources() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DataSources /></QueryClientProvider>);
}

describe("sourceRows", () => {
  it("puts the price source first, hides the bundled sample series and lists unregistered plugins switched off", () => {
    const rows = sourceRows(
      [source({}), source({ sourceId: "fixture-corn", name: "Corn price fixture" }), source({ sourceId: "massive", name: "Massive" })],
      [plugin({}), plugin({ id: "broken", errors: ["id: reserved"] })],
    );
    expect(rows.map((row) => row.source.sourceId)).toEqual(["massive", "cftc-cot", "example-weather"]);
    expect(rows[2]).toMatchObject({ source: { enabled: false }, plugin: { id: "example-weather" } });
  });
});

describe("sourceStatus", () => {
  it("says whether a source is paused, waiting for a key, failing, or how long since it updated", () => {
    expect(sourceStatus({ enabled: false, state: "ok", lastOk: null }, true, NOW).label).toBe("Paused");
    expect(sourceStatus({ enabled: true, state: "ok", lastOk: null }, true, NOW).label).toBe("Needs a key");
    expect(sourceStatus({ enabled: true, state: "error", lastOk: null }, false, NOW)).toEqual({ status: "error", label: "Last refresh failed" });
    expect(sourceStatus({ enabled: true, state: "ok", lastOk: "2026-11-01T10:00:00Z" }, false, NOW)).toEqual({ status: "ok", label: "Updated 2h ago" });
    expect(sourceStatus({ enabled: true, state: "idle", lastOk: null }, false, NOW).label).toBe("Not loaded yet");
  });
});

describe("DataSources", () => {
  beforeEach(() => {
    ipc.listSources.mockResolvedValue([
      source({ sourceId: "massive", name: "Massive · CBOT futures", state: "idle", lastOk: null }),
      source({}),
      source({ sourceId: "example-weather", name: "Example weather", enabled: false }),
    ]);
    ipc.listPlugins.mockResolvedValue([plugin({})]);
    ipc.getSecretStatus.mockResolvedValue(false);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("asks for the price key in the price source's own row and saves it to the keychain", async () => {
    ipc.saveSecret.mockResolvedValue(undefined);
    renderSources();
    const field = await screen.findByLabelText("Massive · CBOT futures key");
    const row = field.closest("li")!;
    expect(await within(row).findByText("Needs a key")).toBeTruthy();
    fireEvent.change(field, { target: { value: "secret-123" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(ipc.saveSecret).toHaveBeenCalledWith("massive", "secret-123"));
    expect(await within(row).findByText("Key saved in your keychain.")).toBeTruthy();
  });

  it("offers a key field only to sources that need one", async () => {
    renderSources();
    await screen.findByText("CFTC Commitments of Traders");
    expect(screen.queryByLabelText("CFTC Commitments of Traders key")).toBeNull();
    expect(screen.getByText(/Weekly positions of large traders/)).toBeTruthy();
  });

  it("pauses a source from its menu", async () => {
    ipc.setSourceEnabled.mockResolvedValue(undefined);
    renderSources();
    fireEvent.click(await screen.findByRole("button", { name: "Actions for CFTC Commitments of Traders" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pause" }));
    await waitFor(() => expect(ipc.setSourceEnabled).toHaveBeenCalledWith("cftc-cot", false));
  });

  it("shows a plugin's permissions and keeps refresh off until its secret is saved", async () => {
    ipc.listSources.mockResolvedValue([source({ sourceId: "example-weather", name: "Example weather" })]);
    renderSources();
    expect(await screen.findByText("Connects to: api.example.com")).toBeTruthy();
    expect(screen.getByLabelText("Example weather token")).toBeTruthy();
    expect(screen.getByText("Needs a key")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Example weather" }));
    expect((await screen.findByRole("menuitem", { name: "Refresh now" })).getAttribute("aria-disabled")).toBe("true");
  });

  it("cannot remove a built-in plugin", async () => {
    ipc.listPlugins.mockResolvedValue([plugin({ builtin: true, secrets: [] })]);
    renderSources();
    await screen.findByText("BUILT-IN PLUGIN");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Example weather" }));
    await screen.findByRole("menuitem", { name: "Turn on" });
    expect(screen.queryByRole("menuitem", { name: "Remove plugin" })).toBeNull();
  });

  it("shows a plugin that cannot load, with its problems and a way to remove it", async () => {
    ipc.listPlugins.mockResolvedValue([plugin({ id: "broken", name: "Broken feed", errors: ["request.url: must start with https://"] })]);
    ipc.removePlugin.mockResolvedValue(undefined);
    renderSources();
    expect(await screen.findByText("request.url: must start with https://")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(ipc.removePlugin).toHaveBeenCalledWith("broken"));
  });

  it("shows every manifest problem before anything is installed", async () => {
    ipc.previewPlugin.mockResolvedValue({ errors: ["request.url: must start with https://", "id: reserved"], summary: null });
    renderSources();
    fireEvent.change(await screen.findByLabelText("Paste a plugin.toml"), { target: { value: "id = 'x'" } });
    fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
    expect(await screen.findByText("id: reserved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
  });

  it("installs only after the permissions were reviewed", async () => {
    ipc.previewPlugin.mockResolvedValue({ errors: [], summary: plugin({ id: "new-one", name: "New one" }) });
    ipc.installPlugin.mockResolvedValue(plugin({}));
    renderSources();
    fireEvent.change(await screen.findByLabelText("Paste a plugin.toml"), { target: { value: "id = 'new-one'" } });
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
    fireEvent.click(await screen.findByRole("button", { name: /Install \(starts switched off\)/ }));
    await waitFor(() => expect(ipc.installPlugin).toHaveBeenCalledWith("id = 'new-one'"));
  });
});
