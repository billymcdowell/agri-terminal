// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }));
const ipc = vi.hoisted(() => ({ listWorkspaces: vi.fn(), saveWorkspace: vi.fn(), deleteWorkspace: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => tauri);
vi.mock("@/lib/ipc", () => ipc);

import { listSavedWorkspaces, readLocalLayout, removeWorkspace, storeWorkspace, uniqueWorkspaceId, upsertSummary } from "./saved-workspaces";

describe("saved workspaces", () => {
  afterEach(() => { localStorage.clear(); vi.clearAllMocks(); tauri.isTauri.mockReturnValue(false); });

  it("gives a new workspace an id that leaves existing ones alone", () => {
    expect(uniqueWorkspaceId("Weather desk", [])).toBe("weather-desk");
    expect(uniqueWorkspaceId("Weather desk", ["weather-desk", "weather-desk-2"])).toBe("weather-desk-3");
  });

  it("keeps the summary list in name order when a workspace is added or renamed", () => {
    const list = [{ id: "a", name: "Alpha" }, { id: "c", name: "Charlie" }];
    expect(upsertSummary(list, { id: "b", name: "Bravo" }).map(({ name }) => name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(upsertSummary(list, { id: "a", name: "Zulu" }).map(({ name }) => name)).toEqual(["Charlie", "Zulu"]);
  });

  it("keeps several workspaces apart in the web preview and deletes one without touching the rest", async () => {
    await storeWorkspace("default", "Market overview", '{"a":1}');
    await storeWorkspace("weather", "Weather", '{"b":2}');
    expect(await listSavedWorkspaces()).toEqual([["default", "Market overview", '{"a":1}'], ["weather", "Weather", '{"b":2}']]);
    await removeWorkspace("default");
    expect(await listSavedWorkspaces()).toEqual([["weather", "Weather", '{"b":2}']]);
    expect(readLocalLayout("default")).toBeUndefined();
  });

  it("uses the database in the app and surfaces its errors", async () => {
    tauri.isTauri.mockReturnValue(true);
    ipc.saveWorkspace.mockRejectedValue("Database lock is unavailable");
    await expect(storeWorkspace("weather", "Weather", "{}")).rejects.toBe("Database lock is unavailable");
    ipc.deleteWorkspace.mockResolvedValue(undefined);
    await removeWorkspace("weather");
    expect(ipc.deleteWorkspace).toHaveBeenCalledWith("weather");
    expect(readLocalLayout("weather")).toBeUndefined();
  });
});
