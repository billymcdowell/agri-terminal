// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMenu } from "./workspace-menu";

const saved = [{ id: "default", name: "Market overview" }, { id: "weather", name: "Weather" }];

function renderMenu(overrides: Partial<Parameters<typeof WorkspaceMenu>[0]> = {}) {
  const props = { currentId: "default", currentName: "Market overview", saved, onSwitch: vi.fn(), onSaveAs: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), ...overrides };
  render(<WorkspaceMenu {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Workspaces" }));
  return props;
}

describe("WorkspaceMenu", () => {
  afterEach(cleanup);

  it("switches to another saved workspace", async () => {
    const props = renderMenu();
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Weather" }));
    expect(props.onSwitch).toHaveBeenCalledWith({ id: "weather", name: "Weather" });
  });

  it("saves the layout under a new name, refusing one already in use", async () => {
    const props = renderMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save as new workspace…" }));
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveProperty("value", "Market overview copy");
    fireEvent.change(name, { target: { value: "weather" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "A workspace called “weather” already exists.");
    expect(props.onSaveAs).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "  Trading  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
    await waitFor(() => expect(props.onSaveAs).toHaveBeenCalledWith("Trading"));
  });

  it("deletes the open workspace after confirmation, but never the last one", async () => {
    const props = renderMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete “Market overview”…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalled());
    cleanup();
    renderMenu({ saved: [saved[0]] });
    expect((await screen.findByRole("menuitem", { name: "Delete “Market overview”…" })).getAttribute("aria-disabled")).toBe("true");
  });
});
