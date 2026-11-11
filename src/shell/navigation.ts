import { create } from "zustand";

export type PageId = "market" | "crop" | "supply" | "river" | "alerts" | "settings" | "help";

/** The five fixed pages, in sidebar order. Each answers one question. */
export const PAGES: { id: PageId; label: string; question: string }[] = [
  { id: "market", label: "Market", question: "What is the price doing, and what moved it?" },
  { id: "crop", label: "Crop & weather", question: "How is the crop doing?" },
  { id: "supply", label: "Supply & demand", question: "Is there more or less grain than needed, and how are traders positioned?" },
  { id: "river", label: "River", question: "Can grain get downriver, and what does it cost?" },
  { id: "alerts", label: "Alerts", question: "Tell me when something happens." },
];

/** Settings and Help sit below the pages in the sidebar. */
export const UTILITY_PAGES: { id: PageId; label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "help", label: "Help" },
];

const PAGE_IDS = new Set<string>([...PAGES, ...UTILITY_PAGES].map((page) => page.id));
export function isPageId(value: unknown): value is PageId { return typeof value === "string" && PAGE_IDS.has(value); }

/** Every section of every page, with the command-bar text that goes to it. Keys match the Help guides. */
export type Section = { kind: string; title: string; page: PageId; command: string };
export const SECTIONS: Section[] = [
  { kind: "market", title: "Price chart", page: "market", command: "ZC" },
  { kind: "moves", title: "Move explainer", page: "market", command: "MOVES" },
  { kind: "calendar", title: "Report calendar", page: "market", command: "CALENDAR" },
  { kind: "news", title: "Market news", page: "market", command: "NEWS" },
  { kind: "crop-stress", title: "Crop stress timeline", page: "crop", command: "STRESS" },
  { kind: "crop-condition", title: "Crop condition", page: "crop", command: "CROP CONDITION" },
  { kind: "drought", title: "Drought Monitor", page: "crop", command: "DROUGHT IOWA" },
  { kind: "weather", title: "Weather", page: "crop", command: "WX IOWA" },
  { kind: "wasde", title: "Supply and demand", page: "supply", command: "WASDE" },
  { kind: "cot", title: "COT positioning", page: "supply", command: "ZC COT" },
  { kind: "river", title: "River status", page: "river", command: "RIVER" },
  { kind: "river-timeline", title: "River timeline", page: "river", command: "RIVER TIMELINE" },
  { kind: "alerts", title: "Price alerts", page: "alerts", command: "ALERTS" },
];

/** The page that shows a section, such as "supply" for "cot". Help is its own page. */
export function pageOf(kind: string): PageId {
  if (kind === "help") return "help";
  return SECTIONS.find((section) => section.kind === kind)?.page ?? "market";
}

/** The page on screen. The app reopens on the last one. */
export const useNavigation = create<{ page: PageId; go: (page: PageId) => void }>((set) => ({
  page: "market",
  go: (page) => set({ page }),
}));
