import { create } from "zustand";
import { useNavigation } from "@/shell/navigation";

export type SettingsSection = "general" | "sources" | "data";

type SettingsScreen = {
  section: SettingsSection;
  /** Goes to the Settings page at a section; sections use this to send the user to a key or a source. */
  show: (section?: SettingsSection) => void;
  setSection: (section: SettingsSection) => void;
};

export const useSettingsScreen = create<SettingsScreen>((set) => ({
  section: "general",
  show: (section = "general") => { set({ section }); useNavigation.getState().go("settings"); },
  setSection: (section) => set({ section }),
}));
