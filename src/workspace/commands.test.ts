import { describe, expect, it } from "vitest";
import { planCommand } from "./commands";

describe("planCommand", () => {
  it("switches to the crop a command names", () => {
    expect(planCommand("zw cot")).toEqual({ type: "open", params: { kind: "cot" }, crop: "ZW" });
    expect(planCommand("ZS")).toEqual({ type: "open", params: { kind: "market" }, crop: "ZS" });
  });
  it("resolves drought states by name or abbreviation", () => {
    expect(planCommand("DROUGHT Iowa")).toEqual({ type: "open", params: { kind: "drought", region: "ia" } });
    expect(planCommand("drought KS")).toMatchObject({ params: { region: "ks" } });
  });
  it("rejects unknown commodities and states with a helpful message", () => {
    expect(planCommand("XX")).toMatchObject({ type: "error", message: expect.stringContaining("Unknown commodity XX") });
    expect(planCommand("DROUGHT Atlantis")).toMatchObject({ type: "error" });
    expect(planCommand("nonsense words")).toMatchObject({ type: "error" });
  });
  it("opens the combined view and the move explainer for the current crop", () => {
    expect(planCommand("stress")).toEqual({ type: "open", params: { kind: "crop-stress" } });
    expect(planCommand("moves")).toEqual({ type: "open", params: { kind: "moves" } });
  });
  it("opens the river panels at a gauge, a river or the default gauge", () => {
    expect(planCommand("RIVER")).toEqual({ type: "open", params: { kind: "river", gauge: "stlouis" } });
    expect(planCommand("RIVER MISS")).toEqual({ type: "open", params: { kind: "river", gauge: "stlouis" } });
    expect(planCommand("river memphis")).toEqual({ type: "open", params: { kind: "river", gauge: "memphis" } });
    expect(planCommand("RIVER TIMELINE")).toEqual({ type: "open", params: { kind: "river-timeline", gauge: "stlouis" } });
    expect(planCommand("RIVER TIMELINE Memphis")).toMatchObject({ params: { kind: "river-timeline", gauge: "memphis" } });
    expect(planCommand("RIVER Rhine")).toMatchObject({ type: "error", message: expect.stringContaining("RIVER MEMPHIS") });
  });
  it("opens Settings, which replaced the settings, plugins and raw data panels", () => {
    expect(planCommand("settings")).toEqual({ type: "settings" });
    expect(planCommand("plugins")).toMatchObject({ type: "error" });
    expect(planCommand("raw data")).toMatchObject({ type: "error" });
  });
  it("opens the guide, and points to it from unrecognized commands", () => {
    expect(planCommand("help")).toEqual({ type: "open", params: { kind: "help" } });
    expect(planCommand("nonsense")).toMatchObject({ type: "error", message: expect.stringContaining("Type HELP") });
  });
  it("loads known templates and rejects unknown ones", () => {
    expect(planCommand("TEMPLATE trader")).toEqual({ type: "template", id: "trader" });
    expect(planCommand("TEMPLATE pirate")).toMatchObject({ type: "error" });
  });
  it("switches workspaces by name", () => {
    expect(planCommand("WS Morning desk")).toEqual({ type: "workspace", name: "Morning desk" });
  });
});
