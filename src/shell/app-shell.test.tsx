// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  saveSecret: vi.fn(),
  listCalendarEvents: vi.fn(async () => []),
  subscribeToDataUpdates: () => Promise.resolve(() => undefined),
  subscribeToAlerts: () => Promise.resolve(() => undefined),
  subscribeToRiverAlerts: () => Promise.resolve(() => undefined),
}));
vi.mock("@/lib/ipc", () => ipc);
vi.mock("@tauri-apps/plugin-notification", () => ({ isPermissionGranted: async () => false, requestPermission: async () => "denied", sendNotification: vi.fn() }));
// Each page's sections have their own tests; here a page is just its name.
vi.mock("./pages", () => ({
  PageBody: ({ page }: { page: string }) => <p data-testid="page-body">{page}</p>,
  useDroughtRegion: () => ["ia", vi.fn()],
  useRiverGauge: () => ["stlouis", vi.fn()],
}));

import { AppShell } from "./app-shell";
import { useCrop } from "./crop";
import { useNavigation } from "./navigation";

// The command list measures itself, which jsdom cannot do.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => undefined;

/** Lets the saved crop and page load, as they do at launch before anyone clicks. */
const settled = async () => {
  await waitFor(() => expect(ipc.getSetting).toHaveBeenCalledWith("page"));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AppShell Market={() => null} /></QueryClientProvider>);
}

describe("AppShell", () => {
  beforeEach(() => {
    ipc.settings = { profile: JSON.stringify({ commodities: ["ZC"], region: "ia" }) };
    ipc.getSetting.mockImplementation(async (key: string) => ipc.settings[key] ?? null);
    ipc.setSetting.mockImplementation(async (key: string, value: string) => { ipc.settings[key] = value; });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); useNavigation.setState({ page: "market" }); useCrop.setState({ crop: "ZC" }); });

  it("opens on the Market page with five pages, then Settings and Help, in the sidebar", async () => {
    renderShell();
    expect(screen.getByRole("heading", { level: 1, name: "Market" })).toBeTruthy();
    const links = screen.getAllByRole("button").filter((button) => button.className.includes("app-nav-link")).map((button) => button.textContent);
    expect(links).toEqual(["Market1", "Crop & weather2", "Supply & demand3", "River4", "Alerts5", "Settings", "Help?"]);
    expect(screen.getByRole("button", { name: /Market/ }).getAttribute("aria-current")).toBe("page");
  });

  it("goes to a page from the sidebar and from the number keys, and remembers it", async () => {
    renderShell();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /River/ }));
    expect(screen.getByTestId("page-body").textContent).toBe("river");
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByRole("heading", { level: 1, name: "Supply & demand" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByTestId("page-body").textContent).toBe("help");
    await waitFor(() => expect(ipc.setSetting).toHaveBeenCalledWith("page", '"help"'));
  });

  it("keeps a page picked before the saved one has loaded", async () => {
    ipc.settings.page = '"river"';
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /Alerts/ }));
    await settled();
    expect(screen.getByTestId("page-body").textContent).toBe("alerts");
  });

  it("reopens on the page it was left on", async () => {
    ipc.settings.page = '"river"';
    renderShell();
    await waitFor(() => expect(screen.getByTestId("page-body").textContent).toBe("river"));
  });

  it("finds a crop by name or ticker in Go to… and switches to it", async () => {
    renderShell();
    await settled();
    fireEvent.keyDown(window, { key: "/" });
    const input = await screen.findByLabelText("Search");
    fireEvent.change(input, { target: { value: "zs" } });
    fireEvent.click(await screen.findByRole("option", { name: /Soybeans/ }));
    expect(useCrop.getState().crop).toBe("ZS");
  });

  it("goes to the page of a section, a state or a setting picked in Go to…", async () => {
    renderShell();
    await settled();
    const pick = async (text: string, name: RegExp) => {
      fireEvent.keyDown(window, { key: "/" });
      fireEvent.change(await screen.findByLabelText("Search"), { target: { value: text } });
      fireEvent.click(await screen.findByRole("option", { name }));
    };
    await pick("commitments", /COT positioning/);
    expect(screen.getByTestId("page-body").textContent).toBe("supply");
    await pick("nebraska", /Drought in Nebraska/);
    expect(screen.getByTestId("page-body").textContent).toBe("crop");
    await pick("theme", /General settings/);
    expect(screen.getByTestId("page-body").textContent).toBe("settings");
  });

  it("shows pages, crops and settings before anything is typed, and Help terms once searching", async () => {
    renderShell();
    fireEvent.keyDown(window, { key: "/" });
    await screen.findByLabelText("Search");
    expect(screen.getByRole("option", { name: /Supply & demand/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Ending stocks/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "ending" } });
    expect(await screen.findByRole("option", { name: /Ending stocks/ })).toBeTruthy();
  });

  it("has no workspace, layout, pop-out or link-group controls", () => {
    renderShell();
    for (const name of [/Save/, /Pop out/, /Add panel/, /Workspace/, /LINK/]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByLabelText("Workspace name")).toBeNull();
  });

  it("opens the first chosen crop on the Market page after setup", async () => {
    ipc.settings = {};
    useNavigation.setState({ page: "river" });
    renderShell();
    fireEvent.click(await screen.findByLabelText("Corn"));
    fireEvent.click(screen.getByLabelText("Wheat"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(useCrop.getState().crop).toBe("ZW"));
    expect(useNavigation.getState().page).toBe("market");
  });
});
