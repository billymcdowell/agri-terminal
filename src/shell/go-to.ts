import { COMMODITIES, CROP_NAMES, REGIONS } from "@/lib/regions";
import { GAUGES } from "@/lib/waterways";
import { GLOSSARY, PANEL_GUIDES } from "@/panels/help-text";
import type { SettingsSection } from "@/settings/use-settings-screen";
import { PAGES, SECTIONS, UTILITY_PAGES, type PageId } from "./navigation";

/** What picking a Go to… result does. */
export type GoToTarget =
  | { type: "page"; page: PageId }
  | { type: "crop"; crop: string }
  | { type: "settings"; section: SettingsSection }
  | { type: "drought"; region: string }
  | { type: "gauge"; gauge: string }
  /** Help at a section's topic, or searching for a glossary term. */
  | { type: "help"; topic?: string; query?: string };

export type GoToGroup = "Pages" | "Crops" | "Sections" | "Settings" | "States and gauges" | "Help";

export type GoToItem = {
  id: string;
  label: string;
  /** Where the result leads, shown at the right of the row. */
  hint: string;
  group: GoToGroup;
  /** Other words that find it, such as ZC for corn or "theme" for General settings. */
  keywords: string[];
  target: GoToTarget;
};

/** Groups shown before anything is typed; the rest appear once a search narrows them. */
export const ALWAYS_SHOWN: GoToGroup[] = ["Pages", "Crops", "Settings"];

const pageLabel = (page: PageId) => [...PAGES, ...UTILITY_PAGES].find((item) => item.id === page)?.label ?? page;

const SETTINGS_ITEMS: { section: SettingsSection; label: string; keywords: string[] }[] = [
  { section: "general", label: "General settings", keywords: ["theme", "dark", "light", "units", "tonne", "bushel", "setup", "onboarding", "preferences"] },
  { section: "sources", label: "Data sources and keys", keywords: ["keys", "api", "massive", "nass", "fas", "plugins", "refresh", "pause", "test connection", "sources"] },
  { section: "data", label: "Data and export", keywords: ["export", "csv", "data folder", "raw data", "stored rows", "database"] },
];

/** Every place Go to… can take you, built from the pages, crops, sections, settings, states, gauges and Help. */
export function goToItems(): GoToItem[] {
  return [
    ...PAGES.map((page, index): GoToItem => ({
      id: `page:${page.id}`, label: page.label, hint: `Page ${index + 1}`, group: "Pages",
      keywords: [page.question], target: { type: "page", page: page.id },
    })),
    ...UTILITY_PAGES.map((page): GoToItem => ({
      id: `page:${page.id}`, label: page.label, hint: "Page", group: "Pages", keywords: [], target: { type: "page", page: page.id },
    })),
    ...COMMODITIES.map((crop): GoToItem => ({
      id: `crop:${crop}`, label: CROP_NAMES[crop] ?? crop, hint: "Switch crop", group: "Crops",
      keywords: [crop], target: { type: "crop", crop },
    })),
    ...SECTIONS.map((section): GoToItem => ({
      id: `section:${section.kind}`, label: section.title, hint: pageLabel(section.page), group: "Sections",
      // The Help summary names the section's sources and terms, such as "Commitments of Traders" for COT.
      keywords: [PANEL_GUIDES[section.kind]?.oneLine ?? "", PANEL_GUIDES[section.kind]?.summary ?? ""], target: { type: "page", page: section.page },
    })),
    ...SETTINGS_ITEMS.map((item): GoToItem => ({
      id: `settings:${item.section}`, label: item.label, hint: "Settings", group: "Settings",
      keywords: item.keywords, target: { type: "settings", section: item.section },
    })),
    ...REGIONS.map((region): GoToItem => ({
      id: `drought:${region.id}`, label: `Drought in ${region.name}`, hint: "Crop & weather", group: "States and gauges",
      keywords: [region.id.toUpperCase(), "drought monitor", "state"], target: { type: "drought", region: region.id },
    })),
    ...GAUGES.map((gauge): GoToItem => ({
      id: `gauge:${gauge.id}`, label: `River at ${gauge.name}`, hint: "River", group: "States and gauges",
      keywords: [gauge.riverName, "gauge", "barge"], target: { type: "gauge", gauge: gauge.id },
    })),
    ...SECTIONS.map((section): GoToItem => ({
      id: `help:${section.kind}`, label: `How to read ${section.title}`, hint: "Help", group: "Help",
      keywords: ["help", "guide", "explain"], target: { type: "help", topic: section.kind },
    })),
    ...GLOSSARY.map(([term]): GoToItem => ({
      id: `term:${term}`, label: term, hint: "Glossary", group: "Help",
      keywords: ["glossary", "meaning"], target: { type: "help", query: term },
    })),
  ];
}

/**
 * How well a result matches the search, from 0 (hidden) to 1. Every word typed must appear in the
 * result's name or its keywords; whole words in the name rank highest. Plain word matching rather
 * than letter-by-letter fuzzy matching, so "memphis" finds the Memphis gauge and not every long
 * description that happens to contain those letters in order.
 */
export function goToScore(label: string, keywords: string[], search: string) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const name = label.toLowerCase();
  const extra = keywords.join(" ").toLowerCase();
  // A keyword typed in full, such as the ticker ZW, counts as much as the name.
  const exact = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  let score = 0;
  for (const word of words) {
    if (exact.has(word) || new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name)) score += 3;
    else if (name.includes(word)) score += 2;
    else if (extra.includes(word)) score += 1;
    else return 0;
  }
  return score / (3 * words.length);
}
