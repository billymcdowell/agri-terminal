// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@/lib/ipc", () => ipc);
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

import { applyTheme } from "@/lib/theme";
import { Preferences } from "./settings-panel";

function renderPreferences() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Preferences /></QueryClientProvider>);
}

describe("Preferences", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); applyTheme("dark"); });

  it("switches the whole app between dark and light", () => {
    ipc.getSetting.mockResolvedValue(null);
    renderPreferences();
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("saves the price unit and the release alert lead time", async () => {
    ipc.getSetting.mockResolvedValue(null);
    ipc.setSetting.mockResolvedValue(undefined);
    renderPreferences();
    fireEvent.change(screen.getByLabelText("Price units"), { target: { value: "metric" } });
    fireEvent.change(screen.getByLabelText("Release alerts"), { target: { value: "6" } });
    await waitFor(() => expect(ipc.setSetting).toHaveBeenCalledWith("units", '"metric"'));
    expect(ipc.setSetting).toHaveBeenCalledWith("release-alert-lead-hours", "6");
  });

  it("shows previously saved values", async () => {
    ipc.getSetting.mockImplementation(async (key: string) => (key === "units" ? '"metric"' : key === "release-alert-lead-hours" ? "0" : null));
    renderPreferences();
    await waitFor(() => expect((screen.getByLabelText("Price units") as HTMLSelectElement).value).toBe("metric"));
    expect((screen.getByLabelText("Release alerts") as HTMLSelectElement).value).toBe("0");
  });
});
