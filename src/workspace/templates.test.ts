import { describe, expect, it } from "vitest";
import { registerBuiltInPanels } from "@/panels/register";
import { getPanel } from "./registry";
import { linkGroupTargets, planTemplate, TEMPLATES } from "./templates";

describe("workspace templates", () => {
  registerBuiltInPanels(() => null);
  it("ships a farmer, trader, analyst and student template", () => {
    expect(TEMPLATES.map((template) => template.id)).toEqual(["farmer", "trader", "analyst", "student"]);
  });
  it("only references registered panels and earlier panels", () => {
    for (const template of TEMPLATES) {
      template.panels.forEach((panel, index) => {
        expect(getPanel(panel.kind), `${template.id}: ${panel.kind}`).toBeDefined();
        if (index === 0) expect(panel.ref).toBeUndefined();
        else expect(panel.ref, `${template.id} panel ${index}`).toBeLessThan(index);
      });
    }
  });
  it("puts the user's home state into drought panels", () => {
    const farmer = TEMPLATES.find((template) => template.id === "farmer")!;
    const planned = planTemplate(farmer, { region: "ks" });
    expect(planned.find((item) => item.params.kind === "drought")?.params.region).toBe("ks");
    expect(planned[0].position).toBeUndefined();
  });
  it("assigns the first two commodities to link groups A and B", () => {
    expect(linkGroupTargets(["ZW", "ZS", "ZC"])).toEqual({ A: "ZW", B: "ZS" });
    expect(linkGroupTargets(["ZC"])).toEqual({ A: "ZC" });
  });
});
