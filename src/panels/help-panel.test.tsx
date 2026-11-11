// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { planCommand } from "@/shell/commands";
import { pageOf, SECTIONS, useNavigation } from "@/shell/navigation";
import { HelpPanel } from "./help-panel";
import { PANEL_GUIDES } from "./help-text";
import { PanelHeader } from "./panel-header";

describe("HelpPanel", () => {
  afterEach(() => { cleanup(); useNavigation.setState({ page: "market" }); });

  it("has a guide for every section, and every section's command goes to its page", () => {
    for (const section of SECTIONS) {
      expect(PANEL_GUIDES[section.kind], section.kind).toBeDefined();
      const plan = planCommand(section.command);
      expect(plan, section.command).toMatchObject({ type: "open", params: { kind: section.kind } });
      if (plan.type === "open") expect(pageOf(plan.params.kind)).toBe(section.page);
    }
  });

  it("goes to the page that shows a listed section", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Go to COT positioning" }));
    expect(useNavigation.getState().page).toBe("supply");
  });

  it("narrows to the sections and terms that match a search", () => {
    render(<HelpPanel />);
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "ending stocks" } });
    expect(screen.getByRole("button", { name: "Go to Supply and demand" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Go to Price chart" })).toBeNull();
    expect(screen.getAllByText("Ending stocks").length).toBeGreaterThan(0);
    expect(screen.queryByText("Start here")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "zzzz" } });
    expect(screen.getByText(/Nothing in the guide matches/)).toBeTruthy();
  });

  it("no longer teaches workspaces, templates, link groups or pop-outs", () => {
    render(<HelpPanel />);
    const text = document.body.textContent ?? "";
    for (const retired of ["workspace", "TEMPLATE", "link group", "Pop the active panel", "Alt+"]) expect(text).not.toContain(retired);
  });
});

describe("PanelHeader About", () => {
  afterEach(cleanup);

  it("shows the section's guide in place", () => {
    render(<PanelHeader eyebrow="COT PANEL" title="Commitments of Traders · ZC" kind="cot" />);
    expect(screen.queryByLabelText("About this panel", { selector: "section" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About this panel" }));
    const about = screen.getByLabelText("About this panel", { selector: "section" });
    expect(within(about).getByText("Managed money")).toBeTruthy();
    expect(within(about).getByText(/One contract is 5,000 bushels/)).toBeTruthy();
  });

  it("has no panel settings button", () => {
    render(<PanelHeader eyebrow="DROUGHT PANEL" title="Drought Monitor · Iowa" kind="drought" />);
    expect(screen.queryByRole("button", { name: "Panel settings" })).toBeNull();
  });
});
