// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/lib/ipc";

const ipc = vi.hoisted(() => ({
  listPlugins: vi.fn(), previewPlugin: vi.fn(), installPlugin: vi.fn(), removePlugin: vi.fn(),
  savePluginSecret: vi.fn(), setSourceEnabled: vi.fn(), refreshSource: vi.fn(), listSources: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  ...ipc,
  subscribeToSourceStatus: () => Promise.resolve(() => undefined),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
}));

import { PluginsPanel } from "./plugins-panel";

const plugin = (patch: Partial<PluginSummary>): PluginSummary => ({
  id: "example-weather", name: "Example weather", version: "1.0.0", description: "", licenseNote: "", builtin: false,
  hosts: ["api.example.com"], secrets: [{ name: "token", configured: false }], series: ["plugin.example-weather.temp"], cadence: "daily", errors: [], ...patch,
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PluginsPanel api={{ setTitle: vi.fn(), updateParameters: vi.fn() }} params={{ kind: "plugins" }} /></QueryClientProvider>);
}

describe("PluginsPanel", () => {
  beforeEach(() => {
    ipc.listPlugins.mockResolvedValue([plugin({})]);
    ipc.listSources.mockResolvedValue([{ sourceId: "example-weather", enabled: false }]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("shows permissions and keeps refresh off until a required secret is saved", async () => {
    renderPanel();
    expect(await screen.findByText("Connects to: api.example.com")).toBeTruthy();
    expect(screen.getByText(/token \(required\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Refresh now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows every manifest problem before anything is installed", async () => {
    ipc.previewPlugin.mockResolvedValue({ errors: ["request.url: must start with https://", "id: reserved"], summary: null });
    renderPanel();
    fireEvent.change(await screen.findByLabelText("Paste a plugin.toml"), { target: { value: "id = 'x'" } });
    fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
    expect(await screen.findByText("request.url: must start with https://")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
  });

  it("installs only after the permissions were reviewed", async () => {
    ipc.previewPlugin.mockResolvedValue({ errors: [], summary: plugin({ id: "new-one", name: "New one" }) });
    ipc.installPlugin.mockResolvedValue(plugin({}));
    renderPanel();
    fireEvent.change(await screen.findByLabelText("Paste a plugin.toml"), { target: { value: "id = 'new-one'" } });
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
    fireEvent.click(await screen.findByRole("button", { name: /Install \(starts switched off\)/ }));
    await waitFor(() => expect(ipc.installPlugin).toHaveBeenCalledWith("id = 'new-one'"));
  });

  it("cannot remove a built-in plugin from the interface", async () => {
    ipc.listPlugins.mockResolvedValue([plugin({ builtin: true, secrets: [] })]);
    renderPanel();
    await screen.findByText("BUILT IN");
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
