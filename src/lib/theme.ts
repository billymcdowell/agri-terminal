import { create } from "zustand";

export type ThemeSetting = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "agri-terminal-theme";

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  return setting === "system" ? (prefersDark ? "dark" : "light") : setting;
}

export function readStoredTheme(): ThemeSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "system" || stored === "dark" ? stored : "dark";
  } catch {
    return "dark";
  }
}

/** Sets what the shadcn tokens (the `dark` class) and the terminal palette (`data-theme`) key off. */
export function applyTheme(resolved: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
}

const prefersDark = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

type ThemeState = { setting: ThemeSetting; resolved: ResolvedTheme; setSetting: (setting: ThemeSetting) => void };

export const useTheme = create<ThemeState>((set) => {
  const setting = readStoredTheme();
  return {
    setting,
    resolved: resolveTheme(setting, prefersDark()),
    setSetting: (next) => {
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Storage can be unavailable. */ }
      const resolved = resolveTheme(next, prefersDark());
      applyTheme(resolved);
      set({ setting: next, resolved });
    },
  };
});

/** Applies the stored theme and keeps it current when the system theme or another window changes. */
export function initTheme(): () => void {
  const sync = () => {
    const setting = readStoredTheme();
    const resolved = resolveTheme(setting, prefersDark());
    applyTheme(resolved);
    useTheme.setState({ setting, resolved });
  };
  sync();
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) sync(); };
  media?.addEventListener("change", sync);
  window.addEventListener("storage", onStorage);
  return () => { media?.removeEventListener("change", sync); window.removeEventListener("storage", onStorage); };
}

/** Colors for libraries that cannot read CSS variables (canvas charts, the map). Pairs with src/theme.css. */
export type Palette = {
  chartBackground: string; text: string; muted: string; grid: string; gridStrong: string; border: string; crosshair: string;
  up: string; down: string; price: string; condition: string; conditionBand: string; drought: string;
  tooltipBackground: string; tooltipBorder: string; mapStroke: string;
  groups: Record<string, string>;
};

export const PALETTES: Record<ResolvedTheme, Palette> = {
  dark: {
    chartBackground: "#101411", text: "#828c83", muted: "#829083", grid: "rgba(167, 180, 164, 0.07)", gridStrong: "rgba(167, 180, 164, 0.09)", border: "rgba(167, 180, 164, 0.14)", crosshair: "#889488",
    up: "#8aac75", down: "#d77b68", price: "#dce4d7", condition: "#88ac75", conditionBand: "rgba(136,172,117,0.18)", drought: "#c49458",
    tooltipBackground: "#101411", tooltipBorder: "#343a34", mapStroke: "#f3eee4",
    groups: { A: "#88ac75", B: "#c49458", C: "#7a9db8" },
  },
  light: {
    chartBackground: "#ebefec", text: "#566057", muted: "#566057", grid: "rgba(40, 56, 42, 0.08)", gridStrong: "rgba(40, 56, 42, 0.10)", border: "rgba(40, 56, 42, 0.2)", crosshair: "#5a665b",
    up: "#3d7a2a", down: "#b3402b", price: "#1b2017", condition: "#3d7a2a", conditionBand: "rgba(61,122,42,0.16)", drought: "#8a5a1c",
    tooltipBackground: "#f7f9f7", tooltipBorder: "#c5cbc5", mapStroke: "#ffffff",
    groups: { A: "#3d7a2a", B: "#8a5a1c", C: "#2f6a94" },
  },
};

export function usePalette(): Palette {
  return PALETTES[useTheme((state) => state.resolved)];
}
