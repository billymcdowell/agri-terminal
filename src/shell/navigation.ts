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

/** Every section of every page. Keys match the Help guides. */
export type Section = { kind: string; title: string; page: PageId };
export const SECTIONS: Section[] = [
  { kind: "market", title: "Price chart", page: "market" },
  { kind: "moves", title: "Move explainer", page: "market" },
  { kind: "calendar", title: "Report calendar", page: "market" },
  { kind: "news", title: "Market news", page: "market" },
  { kind: "crop-stress", title: "Crop stress timeline", page: "crop" },
  { kind: "crop-condition", title: "Crop condition", page: "crop" },
  { kind: "drought", title: "Drought Monitor", page: "crop" },
  { kind: "weather", title: "Weather", page: "crop" },
  { kind: "wasde", title: "Supply and demand", page: "supply" },
  { kind: "cot", title: "COT positioning", page: "supply" },
  { kind: "river", title: "River status", page: "river" },
  { kind: "river-timeline", title: "River timeline", page: "river" },
  { kind: "alerts", title: "Price alerts", page: "alerts" },
];

type Navigation = {
  page: PageId;
  /** The section Help opens at, such as "cot", set by a section's "More in Help" link. */
  helpTopic: string | null;
  /** A search Help starts with, such as a glossary term picked in Go to…. */
  helpQuery: string | null;
  go: (page: PageId) => void;
  openHelp: (topic: string | null, query?: string) => void;
  clearHelpTopic: () => void;
};

/** The page on screen. The app reopens on the last one. */
export const useNavigation = create<Navigation>((set) => ({
  page: "market",
  helpTopic: null,
  helpQuery: null,
  go: (page) => set({ page }),
  openHelp: (topic, query) => set({ page: "help", helpTopic: topic, helpQuery: query ?? null }),
  clearHelpTopic: () => set({ helpTopic: null, helpQuery: null }),
}));
