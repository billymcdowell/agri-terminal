import type { ComponentType } from "react";
import { LINK_GROUP_PROPERTY, type ConfigSchema } from "@/lib/config-schema";
import { REGIONS } from "@/lib/regions";
import { getPanel, registerPanel } from "@/workspace/registry";
import type { PanelComponentProps } from "@/workspace/types";
import { AlertsPanel } from "./alerts-panel";
import { CalendarPanel } from "./calendar-panel";
import { CropStressPanel } from "./crop-stress-panel";
import { HelpPanel } from "./help-panel";
import { MoveExplainerPanel } from "./move-explainer-panel";
import { MetricPanel } from "./metric-panel";
import { PluginsPanel } from "./plugins-panel";
import { RawDataPanel } from "./raw-data-panel";
import { SettingsPanel } from "./settings-panel";
import { NewsPanel } from "./news-panel";
import { WeatherPanel } from "./weather-panel";
import { usePanelCommodity } from "./panel-header";

const linkSchema: ConfigSchema = { type: "object", properties: { linkGroup: LINK_GROUP_PROPERTY } };
const droughtSchema: ConfigSchema = {
  type: "object",
  properties: {
    region: { type: "string", title: "State", enum: REGIONS.map((region) => region.id), enumLabels: Object.fromEntries(REGIONS.map((region) => [region.id, region.name])) },
  },
};
const movesSchema: ConfigSchema = {
  type: "object",
  properties: {
    ...linkSchema.properties,
    threshold: { type: "number", title: "Sensitivity (standard deviations)", description: "Lower flags more moves.", minimum: 1, maximum: 4, multipleOf: 0.5 },
  },
};

export type MarketComponent = ComponentType<{ commodity: string }>;

/** Registers every built-in panel type once. The market panel is supplied by the app because it owns source setup. */
export function registerBuiltInPanels(Market: MarketComponent) {
  if (getPanel("market")) return;
  function MarketPanel({ api, params }: PanelComponentProps) {
    const { commodity } = usePanelCommodity(params, api);
    return <Market commodity={commodity} />;
  }
  registerPanel({ type: "market", title: "Price chart", description: "Daily futures price chart", command: "ZC", defaultConfig: { commodity: "ZC", linkGroup: "A" }, component: MarketPanel });
  registerPanel({ type: "cot", configSchema: linkSchema, title: "COT positioning", description: "Commitments of Traders with historical percentile", command: "ZC COT", defaultConfig: { linkGroup: "A" }, component: MetricPanel });
  registerPanel({ type: "crop-condition", configSchema: linkSchema, title: "Crop condition", description: "NASS crop condition and progress", command: "CROP CONDITION", defaultConfig: { linkGroup: "A" }, component: MetricPanel });
  registerPanel({ type: "wasde", configSchema: linkSchema, title: "Supply and demand", description: "FAS PSD balance sheet", command: "WASDE", defaultConfig: { linkGroup: "A" }, component: MetricPanel });
  registerPanel({ type: "drought", configSchema: { type: "object", properties: { ...droughtSchema.properties, ...linkSchema.properties } }, title: "Drought Monitor", description: "Weekly drought area by severity", command: "DROUGHT IOWA", defaultConfig: { region: "ia" }, component: MetricPanel });
  registerPanel({ type: "crop-stress", configSchema: linkSchema, title: "Crop stress timeline", description: "Price, crop condition and drought on one timeline", command: "STRESS", defaultConfig: { linkGroup: "A" }, component: CropStressPanel });
  registerPanel({ type: "moves", configSchema: movesSchema, title: "Move explainer", description: "Flagged price moves with possible drivers", command: "MOVES", defaultConfig: { linkGroup: "A" }, component: MoveExplainerPanel });
  registerPanel({ type: "alerts", title: "Price alerts", description: "Notify when a daily close crosses a price", command: "ALERTS", defaultConfig: {}, component: AlertsPanel });
  registerPanel({ type: "raw-data", title: "Raw data", description: "Every stored row from each data source", command: "RAW", defaultConfig: {}, component: RawDataPanel });
  registerPanel({ type: "plugins", title: "Plugins", description: "Install and manage data source plugins", command: "PLUGINS", defaultConfig: {}, component: PluginsPanel });
  registerPanel({ type: "settings", title: "Settings and export", description: "Data directory, CSV and workspace export, setup", command: "SETTINGS", defaultConfig: {}, component: SettingsPanel });
  registerPanel({ type: "calendar", title: "Report calendar", description: "Upcoming report release schedule", command: "CALENDAR", defaultConfig: {}, component: CalendarPanel });
  registerPanel({ type: "weather", configSchema: linkSchema, title: "Weather", description: "Regional forecasts for the commodity's growing areas", command: "WX IOWA", defaultConfig: { linkGroup: "A" }, component: WeatherPanel });
  registerPanel({ type: "news", configSchema: linkSchema, title: "Market news", description: "GDELT and USDA RSS headlines", command: "NEWS", defaultConfig: { linkGroup: "A" }, component: NewsPanel });
  registerPanel({ type: "help", title: "Help", description: "Every command, what each panel shows, and a glossary", command: "HELP", defaultConfig: {}, component: HelpPanel });
}
