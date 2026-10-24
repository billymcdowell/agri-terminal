import type { ComponentType } from "react";
import type { PanelComponentProps, PanelParams } from "./types";

export type PanelDefinition = {
  type: string;
  title: string;
  description: string;
  /** Command-bar text that opens this panel. */
  command: string;
  defaultConfig: Partial<PanelParams>;
  component: ComponentType<PanelComponentProps>;
};

const definitions = new Map<string, PanelDefinition>();

export function registerPanel(definition: PanelDefinition) {
  if (definitions.has(definition.type)) throw new Error(`Panel type already registered: ${definition.type}`);
  definitions.set(definition.type, definition);
}

export function getPanel(type: string) { return definitions.get(type); }
export function listPanels() { return [...definitions.values()]; }
