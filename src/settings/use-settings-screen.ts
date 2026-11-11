import { create } from "zustand";
import { useNavigation } from "@/shell/navigation";

export type SettingsSection = "general" | "sources" | "data";

type SettingsScreen = {
  section: SettingsSection;
  /** Data sources lists only the sources that need attention, as when opened from the top bar's ⚠. */
  problemsOnly: boolean;
  /** Goes to the Settings page at a section; sections use this to send the user to a key or a source. */
  show: (section?: SettingsSection, options?: { problemsOnly?: boolean }) => void;
  setSection: (section: SettingsSection) => void;
  showAllSources: () => void;
};

export const useSettingsScreen = create<SettingsScreen>((set) => ({
  section: "general",
  problemsOnly: false,
  show: (section = "general", options) => { set({ section, problemsOnly: options?.problemsOnly ?? false }); useNavigation.getState().go("settings"); },
  setSection: (section) => set({ section, problemsOnly: false }),
  showAllSources: () => set({ problemsOnly: false }),
}));
