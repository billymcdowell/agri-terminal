import type { ComponentType } from "react";
import type { ConfigSchema } from "@/lib/config-schema";
import { REGIONS } from "@/lib/regions";
import { GAUGES } from "@/lib/waterways";
import { useCrop } from "@/workspace/crop";
import { getPanel, registerPanel } from "@/workspace/registry";
import { AlertsPanel } from "./alerts-panel";
import { CalendarPanel } from "./calendar-panel";
import { CropStressPanel } from "./crop-stress-panel";
import { HelpPanel } from "./help-panel";
import { MoveExplainerPanel } from "./move-explainer-panel";
import { MetricPanel } from "./metric-panel";
import { RiverPanel } from "./river-panel";
import { RiverTimelinePanel } from "./river-timeline-panel";
import { NewsPanel } from "./news-panel";
import { WeatherPanel } from "./weather-panel";

const droughtSchema: ConfigSchema = {
  type: "object",
  properties: {
    region: { type: "string", title: "State", enum: REGIONS.map((region) => region.id), enumLabels: Object.fromEntries(REGIONS.map((region) => [region.id, region.name])) },
  },
};
const gaugeSchema: ConfigSchema = {
  type: "object",
  properties: {
    gauge: { type: "string", title: "River gauge", enum: GAUGES.map((gauge) => gauge.id), enumLabels: Object.fromEntries(GAUGES.map((gauge) => [gauge.id, `${gauge.name} · ${gauge.riverName}`])) },
  },
};
const movesSchema: ConfigSchema = {
  type: "object",
  properties: {
    threshold: { type: "number", title: "Sensitivity (standard deviations)", description: "Lower flags more moves.", minimum: 1, maximum: 4, multipleOf: 0.5 },
  },
};

export type MarketComponent = ComponentType<{ commodity: string }>;

/** Registers every built-in panel type once. The market panel is supplied by the app because it owns source setup. */
export function registerBuiltInPanels(Market: MarketComponent) {
  if (getPanel("market")) return;
  function MarketPanel() {
    return <Market commodity={useCrop((state) => state.crop)} />;
  }
  registerPanel({ type: "market", title: "Price chart", description: "Daily futures price chart", command: "ZC", defaultConfig: {}, component: MarketPanel });
  registerPanel({ type: "cot", title: "COT positioning", description: "Commitments of Traders with historical percentile", command: "ZC COT", defaultConfig: {}, component: MetricPanel });
  registerPanel({ type: "crop-condition", title: "Crop condition", description: "NASS crop condition and progress", command: "CROP CONDITION", defaultConfig: {}, component: MetricPanel });
  registerPanel({ type: "wasde", title: "Supply and demand", description: "FAS PSD balance sheet", command: "WASDE", defaultConfig: {}, component: MetricPanel });
  registerPanel({ type: "drought", configSchema: droughtSchema, title: "Drought Monitor", description: "Weekly drought area by severity", command: "DROUGHT IOWA", defaultConfig: { region: "ia" }, component: MetricPanel });
  registerPanel({ type: "crop-stress", title: "Crop stress timeline", description: "Price, crop condition and drought on one timeline", command: "STRESS", defaultConfig: {}, component: CropStressPanel });
  registerPanel({ type: "river", configSchema: gaugeSchema, title: "River status", description: "Low-water constraint score, stage, forecast, barge freight and lock traffic", command: "RIVER", defaultConfig: { gauge: GAUGES[0].id }, component: RiverPanel });
  registerPanel({ type: "river-timeline", configSchema: gaugeSchema, title: "River timeline", description: "River stage, forecast, barge freight and the constraint score beside price", command: "RIVER TIMELINE", defaultConfig: { gauge: GAUGES[0].id }, component: RiverTimelinePanel });
  registerPanel({ type: "moves", configSchema: movesSchema, title: "Move explainer", description: "Flagged price moves with possible drivers", command: "MOVES", defaultConfig: {}, component: MoveExplainerPanel });
  registerPanel({ type: "alerts", title: "Price alerts", description: "Notify when a daily close crosses a price", command: "ALERTS", defaultConfig: {}, component: AlertsPanel });
  registerPanel({ type: "calendar", title: "Report calendar", description: "Upcoming report release schedule", command: "CALENDAR", defaultConfig: {}, component: CalendarPanel });
  registerPanel({ type: "weather", title: "Weather", description: "Regional forecasts for the commodity's growing areas", command: "WX IOWA", defaultConfig: {}, component: WeatherPanel });
  registerPanel({ type: "news", title: "Market news", description: "GDELT and USDA RSS headlines", command: "NEWS", defaultConfig: {}, component: NewsPanel });
  registerPanel({ type: "help", title: "Help", description: "Every command, what each panel shows, and a glossary", command: "HELP", defaultConfig: {}, component: HelpPanel });
}
