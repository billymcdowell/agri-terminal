import templateConfig from "../../config/workspace-templates.json";
import type { PanelParams } from "./types";

export type Role = "farmer" | "trader" | "analyst" | "student";
export type Profile = { role: Role; commodities: string[]; region: string };
export type Direction = "left" | "right" | "above" | "below" | "within";
export type TemplatePanel = { kind: string; region?: string; audience?: string; ref?: number; direction?: Direction };
export type WorkspaceTemplate = { id: Role; name: string; description: string; panels: TemplatePanel[] };

export const TEMPLATES = templateConfig.templates as WorkspaceTemplate[];

export function getTemplate(id: string) { return TEMPLATES.find((template) => template.id === id); }

export type PlannedPanel = { params: PanelParams; position?: { index: number; direction: Direction } };

/** Turns a template and the user's profile into concrete panels. `index` points at an earlier planned panel. */
export function planTemplate(template: WorkspaceTemplate, profile: Pick<Profile, "region">): PlannedPanel[] {
  return template.panels.map((panel, position) => {
    const unlinked = ["calendar", "drought", "river"].includes(panel.kind);
    const params: PanelParams = { kind: panel.kind, linkGroup: unlinked ? undefined : "A" };
    if (panel.kind === "drought") params.region = panel.region === "home" ? profile.region : panel.region;
    if (panel.audience) params.audience = panel.audience;
    if (panel.ref === undefined || panel.ref >= position) return { params };
    return { params, position: { index: panel.ref, direction: panel.direction ?? "right" } };
  });
}

/** Link group A follows the first chosen commodity and B the second, so a farmer of two crops can split them. */
export function linkGroupTargets(commodities: string[]): Record<string, string> {
  const targets: Record<string, string> = {};
  if (commodities[0]) targets.A = commodities[0];
  if (commodities[1]) targets.B = commodities[1];
  return targets;
}
