import type { ComponentType } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { REGIONS } from "@/lib/regions";
import { GAUGES } from "@/lib/waterways";
import { AlertsPanel } from "@/panels/alerts-panel";
import { CalendarPanel } from "@/panels/calendar-panel";
import { CropStressPanel } from "@/panels/crop-stress-panel";
import { HelpPanel } from "@/panels/help-panel";
import { MetricPanel } from "@/panels/metric-panel";
import { MoveExplainerPanel } from "@/panels/move-explainer-panel";
import { NewsPanel } from "@/panels/news-panel";
import { RiverPanel } from "@/panels/river-panel";
import { RiverTimelinePanel } from "@/panels/river-timeline-panel";
import { WeatherPanel } from "@/panels/weather-panel";
import { SettingsPage } from "@/settings/settings-page";
import { usePersistedValue } from "@/state/use-persisted-list";
import { useCrop } from "./crop";
import type { PageId } from "./navigation";
import type { Profile } from "./onboarding";

/** The price chart. App supplies it because it owns the price source setup. */
export type MarketComponent = ComponentType<{ commodity: string }>;

/** The state the Drought Monitor shows: the one picked on the page, else the home state from setup. */
export function useDroughtRegion() {
  const [profile] = usePersistedValue<Profile | null>("profile", null);
  const [region, setRegion] = usePersistedValue<string | null>("drought-region", null);
  return [region ?? profile?.region ?? "ia", setRegion] as const;
}

/** The Mississippi gauge the River page shows. */
export function useRiverGauge() {
  return usePersistedValue<string>("river-gauge", GAUGES[0].id);
}

function MarketPage({ Market }: { Market: MarketComponent }) {
  const crop = useCrop((state) => state.crop);
  return (
    <div className="page-grid">
      <section className="page-section page-wide page-chart"><Market commodity={crop} /></section>
      <section className="page-section"><MoveExplainerPanel /></section>
      <section className="page-section"><NewsPanel /></section>
      <section className="page-section page-wide"><CalendarPanel /></section>
    </div>
  );
}

function CropPage() {
  const [region, setRegion] = useDroughtRegion();
  const picker = (
    <NativeSelect size="sm" aria-label="Drought Monitor state" value={region} onChange={(event) => setRegion(event.currentTarget.value)}>
      {REGIONS.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
    </NativeSelect>
  );
  return (
    <div className="page-grid">
      <section className="page-section page-wide"><CropStressPanel /></section>
      <section className="page-section"><MetricPanel kind="crop-condition" /></section>
      <section className="page-section"><MetricPanel kind="drought" region={region} controls={picker} /></section>
      <section className="page-section page-wide"><WeatherPanel /></section>
    </div>
  );
}

function SupplyPage() {
  return (
    <div className="page-grid">
      <section className="page-section page-wide"><MetricPanel kind="wasde" /></section>
      <section className="page-section page-wide"><MetricPanel kind="cot" /></section>
    </div>
  );
}

function RiverPage() {
  const [gauge, setGauge] = useRiverGauge();
  const picker = (
    <NativeSelect size="sm" aria-label="River gauge" value={gauge} onChange={(event) => setGauge(event.currentTarget.value)}>
      {GAUGES.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
    </NativeSelect>
  );
  return (
    <div className="page-grid">
      <section className="page-section page-wide"><RiverPanel gauge={gauge} controls={picker} /></section>
      <section className="page-section page-wide"><RiverTimelinePanel gauge={gauge} /></section>
    </div>
  );
}

/** The body of a page. Each page has a fixed set of sections; there is no layout to arrange. */
export function PageBody({ page, Market }: { page: PageId; Market: MarketComponent }) {
  switch (page) {
    case "market": return <MarketPage Market={Market} />;
    case "crop": return <CropPage />;
    case "supply": return <SupplyPage />;
    case "river": return <RiverPage />;
    case "alerts": return <div className="page-grid"><section className="page-section page-wide"><AlertsPanel /></section></div>;
    case "settings": return <SettingsPage />;
    case "help": return <div className="page-grid"><section className="page-section page-wide"><HelpPanel /></section></div>;
  }
}
