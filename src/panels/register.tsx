import type { ComponentType } from "react";
import { getPanel, registerPanel } from "@/workspace/registry";
import type { PanelComponentProps } from "@/workspace/types";
import { CalendarPanel } from "./calendar-panel";
import { CropStressPanel } from "./crop-stress-panel";
import { MoveExplainerPanel } from "./move-explainer-panel";
import { MetricPanel } from "./metric-panel";
import { NewsPanel } from "./news-panel";
import { WeatherPanel } from "./weather-panel";
import { usePanelCommodity } from "./panel-header";

export type MarketComponent = ComponentType<{ commodity: string }>;

/** Registers every built-in panel type once. The market panel is supplied by the app because it owns source setup. */
export function registerBuiltInPanels(Market: MarketComponent) {
  if (getPanel("market")) return;
  function MarketPanel({ api, params }: PanelComponentProps) {
    const { commodity } = usePanelCommodity(params, api);
    return <Market commodity={commodity} />;
  }
  registerPanel({ type: "market", title: "Price chart", description: "Daily futures price chart", command: "ZC", defaultConfig: { commodity: "ZC", linkGroup: "A" }, component: MarketPanel });
  registerPanel({ type: "cot", title: "COT positioning", description: "Commitments of Traders with historical percentile", command: "ZC COT", defaultConfig: { linkGroup: "A" }, component: MetricPanel });
  registerPanel({ type: "crop-condition", title: "Crop condition", description: "NASS crop condition and progress", command: "CROP CONDITION", defaultConfig: { linkGroup: "A" }, component: MetricPanel });
  registerPanel({ type: "wasde", title: "Supply and demand", description: "FAS PSD balance sheet", command: "WASDE", defaultConfig: { linkGroup: "A" }, component: MetricPanel });
  registerPanel({ type: "drought", title: "Drought Monitor", description: "Weekly drought area by severity", command: "DROUGHT IOWA", defaultConfig: { region: "ia" }, component: MetricPanel });
  registerPanel({ type: "crop-stress", title: "Crop stress timeline", description: "Price, crop condition and drought on one timeline", command: "STRESS", defaultConfig: { linkGroup: "A" }, component: CropStressPanel });
  registerPanel({ type: "moves", title: "Move explainer", description: "Flagged price moves with possible drivers", command: "MOVES", defaultConfig: { linkGroup: "A" }, component: MoveExplainerPanel });
  registerPanel({ type: "calendar", title: "Report calendar", description: "Upcoming report release schedule", command: "CALENDAR", defaultConfig: {}, component: CalendarPanel });
  registerPanel({ type: "weather", title: "Weather", description: "Regional forecasts for the commodity's growing areas", command: "WX IOWA", defaultConfig: { linkGroup: "A" }, component: WeatherPanel });
  registerPanel({ type: "news", title: "Market news", description: "GDELT and USDA RSS headlines", command: "NEWS", defaultConfig: { linkGroup: "A" }, component: NewsPanel });
}
