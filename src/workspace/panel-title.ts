import { getPanel } from "./registry";
import type { PanelParams } from "./types";

export function panelTitle(params: PanelParams) {
  const title = getPanel(params.kind)?.title ?? params.kind;
  return params.kind === "drought" && params.region ? `${title} · ${params.region.toUpperCase()}` : title;
}
