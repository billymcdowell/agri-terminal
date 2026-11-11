// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { goToItems } from "@/shell/go-to";
import { SECTIONS, useNavigation } from "@/shell/navigation";
import { HelpPanel } from "./help-panel";
import { PANEL_GUIDES } from "./help-text";
import { PanelHeader } from "./panel-header";

describe("HelpPanel", () => {
  afterEach(() => { cleanup(); useNavigation.setState({ page: "market", helpTopic: null, helpQuery: null }); });

  it("has a guide for every section, and Go to… reaches every section and its guide", () => {
    const items = goToItems();
    for (const section of SECTIONS) {
      expect(PANEL_GUIDES[section.kind], section.kind).toBeDefined();
      expect(items.find((item) => item.id === `section:${section.kind}`)?.target, section.kind).toEqual({ type: "page", page: section.page });
      expect(items.find((item) => item.id === `help:${section.kind}`)?.target, section.kind).toEqual({ type: "help", topic: section.kind });
    }
  });

  it("asks the reader to learn no commands", () => {
    render(<HelpPanel />);
    const text = document.body.textContent ?? "";
    for (const command of ["ZC COT", "DROUGHT IOWA", "RIVER TIMELINE", "WASDE.", "Type ", "command bar", "Other commands"]) expect(text).not.toContain(command);
  });

  it("starts with a search a Go to… glossary result asked for", () => {
    useNavigation.getState().openHelp(null, "Basis");
    render(<HelpPanel />);
    expect((screen.getByLabelText("Search help") as HTMLInputElement).value).toBe("Basis");
    expect(screen.queryByText("Start here")).toBeNull();
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

describe("PanelHeader", () => {
  afterEach(() => { cleanup(); useNavigation.setState({ page: "market", helpTopic: null, helpQuery: null }); });

  it("says in one line what the section shows, with no ⓘ toggle", () => {
    render(<PanelHeader title="Commitments of Traders · ZC" kind="cot" />);
    expect(screen.getByText(/Whether big groups of traders are betting on prices rising or falling/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "About this panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Panel settings" })).toBeNull();
  });

  it("links to the section's Help topic, which opens and expands it", () => {
    render(<PanelHeader title="COT positioning" kind="cot" />);
    fireEvent.click(screen.getByRole("button", { name: "More about COT positioning in Help" }));
    expect(useNavigation.getState().page).toBe("help");
    cleanup();
    render(<HelpPanel />);
    const topic = document.getElementById("help-cot") as HTMLDetailsElement;
    expect(topic.open).toBe(true);
    expect(within(topic).getByText("Managed money")).toBeTruthy();
    expect((document.getElementById("help-wasde") as HTMLDetailsElement).open).toBe(false);
    expect(useNavigation.getState().helpTopic).toBeNull();
  });
});
