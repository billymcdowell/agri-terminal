// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  getSetting: vi.fn<(key: string) => Promise<string | null>>(async () => null), setSetting: vi.fn(async () => undefined),
  listSources: vi.fn(async () => []), listPlugins: vi.fn(async () => []),
  subscribeToSourceStatus: () => Promise.resolve(() => undefined),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
}));
vi.mock("@/lib/ipc", () => ipc);
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

import { applyTheme } from "@/lib/theme";
import { useNavigation } from "@/shell/navigation";
import { GeneralSettings, SettingsPage } from "./settings-page";
import { useSettingsScreen } from "./use-settings-screen";

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("GeneralSettings", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); applyTheme("dark"); useSettingsScreen.setState({ section: "general" }); useNavigation.setState({ page: "market" }); });

  it("switches the whole app between dark and light", () => {
    renderWithClient(<GeneralSettings />);
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("saves the price unit and shows a saved one", async () => {
    renderWithClient(<GeneralSettings />);
    fireEvent.change(screen.getByLabelText("Price units"), { target: { value: "metric" } });
    await waitFor(() => expect(ipc.setSetting).toHaveBeenCalledWith("units", '"metric"'));
    cleanup();
    ipc.getSetting.mockImplementation(async (key: string) => (key === "units" ? '"metric"' : null));
    renderWithClient(<GeneralSettings />);
    await waitFor(() => expect((screen.getByLabelText("Price units") as HTMLSelectElement).value).toBe("metric"));
  });

  it("leaves Settings and clears the profile so first-time setup runs again", async () => {
    useSettingsScreen.getState().show();
    expect(useNavigation.getState().page).toBe("settings");
    renderWithClient(<GeneralSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Run first-time setup again" }));
    expect(useNavigation.getState().page).toBe("market");
    await waitFor(() => expect(ipc.setSetting).toHaveBeenCalledWith("profile", "null"));
  });
});

describe("SettingsPage", () => {
  afterEach(() => { cleanup(); useSettingsScreen.setState({ section: "general" }); useNavigation.setState({ page: "market" }); });

  it("opens at the section a page asks for", async () => {
    useSettingsScreen.getState().show("sources");
    expect(useNavigation.getState().page).toBe("settings");
    renderWithClient(<SettingsPage />);
    expect((await screen.findByRole("tab", { name: "Data sources" })).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Where AgriTerminal gets its data/)).toBeTruthy();
  });
});
