import { create } from "zustand";

/** The one crop every page shows, chosen with the switcher in the top bar. */
export const useCrop = create<{ crop: string; setCrop: (crop: string) => void }>((set) => ({
  crop: "ZC",
  setCrop: (crop) => set({ crop }),
}));
