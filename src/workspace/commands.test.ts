import { describe, expect, it } from "vitest";
import { planCommand } from "./commands";

describe("planCommand", () => {
  it("retargets the default link group when a commodity is named", () => {
    expect(planCommand("zw cot")).toEqual({ type: "open", params: { kind: "cot", linkGroup: "A" }, retarget: { group: "A", commodity: "ZW" } });
    expect(planCommand("ZS")).toMatchObject({ params: { kind: "market" }, retarget: { commodity: "ZS" } });
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
  it("opens the combined view and the move explainer in the default link group", () => {
    expect(planCommand("stress")).toEqual({ type: "open", params: { kind: "crop-stress", linkGroup: "A" } });
    expect(planCommand("moves")).toEqual({ type: "open", params: { kind: "moves", linkGroup: "A" } });
  });
  it("opens the river panels at a gauge, a river or the default gauge", () => {
    expect(planCommand("RIVER")).toEqual({ type: "open", params: { kind: "river", gauge: "stlouis" } });
    expect(planCommand("RIVER MISS")).toEqual({ type: "open", params: { kind: "river", gauge: "stlouis" } });
    expect(planCommand("river memphis")).toEqual({ type: "open", params: { kind: "river", gauge: "memphis" } });
    expect(planCommand("RIVER TIMELINE")).toEqual({ type: "open", params: { kind: "river-timeline", gauge: "stlouis", linkGroup: "A" } });
    expect(planCommand("RIVER TIMELINE Memphis")).toMatchObject({ params: { kind: "river-timeline", gauge: "memphis" } });
    expect(planCommand("RIVER Rhine")).toMatchObject({ type: "error", message: expect.stringContaining("RIVER MEMPHIS") });
  });
  it("opens the raw data panel", () => {
    expect(planCommand("raw data")).toEqual({ type: "open", params: { kind: "raw-data" } });
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
