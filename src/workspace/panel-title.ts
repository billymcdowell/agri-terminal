import { findGauge } from "@/lib/waterways";
import { getPanel } from "./registry";
import type { PanelParams } from "./types";

export function panelTitle(params: PanelParams) {
  const title = getPanel(params.kind)?.title ?? params.kind;
  if (params.kind === "drought" && params.region) return `${title} · ${params.region.toUpperCase()}`;
  const gauge = params.gauge ? findGauge(params.gauge) : undefined;
  return gauge && params.kind.startsWith("river") ? `${title} · ${gauge.name}` : title;
}
