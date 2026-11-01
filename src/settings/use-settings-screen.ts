import { create } from "zustand";

export type SettingsSection = "general" | "sources" | "data";

type SettingsScreen = {
  open: boolean;
  section: SettingsSection;
  /** Opens Settings at a section; panels use this to send the user to a key or a source. */
  show: (section?: SettingsSection) => void;
  setSection: (section: SettingsSection) => void;
  close: () => void;
};

export const useSettingsScreen = create<SettingsScreen>((set) => ({
  open: false,
  section: "general",
  show: (section = "general") => set({ open: true, section }),
  setSection: (section) => set({ section }),
  close: () => set({ open: false }),
}));
