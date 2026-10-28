// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerBuiltInPanels } from "./register";
import { onCommandRequest } from "@/workspace/command-events";
import { planCommand } from "@/workspace/commands";
import { listPanels } from "@/workspace/registry";
import { HelpPanel } from "./help-panel";
import { PANEL_GUIDES } from "./help-text";
import { PanelHeader } from "./panel-header";

registerBuiltInPanels(() => null);
const api = () => ({ setTitle: vi.fn(), updateParameters: vi.fn() });

describe("HelpPanel", () => {
  afterEach(cleanup);

  it("has a guide for every panel, and every panel's command opens it", () => {
    for (const panel of listPanels()) {
      expect(PANEL_GUIDES[panel.type], panel.type).toBeDefined();
      expect(planCommand(panel.command), panel.command).toMatchObject({ type: "open", params: { kind: panel.type } });
    }
  });

  it("opens a listed panel through the workspace", () => {
    const handler = vi.fn();
    const stop = onCommandRequest(handler);
    render(<HelpPanel api={api()} params={{ kind: "help" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open COT positioning" }));
    stop();
    expect(handler).toHaveBeenCalledWith("ZC COT");
  });

  it("says where to open a panel when no workspace is listening, as in a pop-out", () => {
    render(<HelpPanel api={api()} params={{ kind: "help" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Supply and demand" }));
    expect(screen.getByRole("status").textContent).toContain("press / and type WASDE");
  });

  it("narrows to the panels and terms that match a search", () => {
    render(<HelpPanel api={api()} params={{ kind: "help" }} />);
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "ending stocks" } });
    expect(screen.getByRole("button", { name: "Open Supply and demand" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Price chart" })).toBeNull();
    expect(screen.getAllByText("Ending stocks").length).toBeGreaterThan(0);
    expect(screen.queryByText("Start here")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "zzzz" } });
    expect(screen.getByText(/Nothing in the guide matches/)).toBeTruthy();
  });
});

describe("PanelHeader About", () => {
  afterEach(cleanup);

  it("shows the panel's guide in place", () => {
    render(<PanelHeader eyebrow="COT PANEL" title="Commitments of Traders · ZC" api={api()} params={{ kind: "cot" }} />);
    expect(screen.queryByLabelText("About this panel", { selector: "section" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About this panel" }));
    const about = screen.getByLabelText("About this panel", { selector: "section" });
    expect(within(about).getByText("Managed money")).toBeTruthy();
    expect(within(about).getByText(/One contract is 5,000 bushels/)).toBeTruthy();
  });
});
