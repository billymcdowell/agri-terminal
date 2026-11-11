import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";

/** The one crop every panel shows, chosen with the switcher in the top bar. */
export const useCrop = create<{ crop: string; setCrop: (crop: string) => void }>((set) => ({
  crop: "ZC",
  setCrop: (crop) => set({ crop }),
}));

const EVENT = "crop-changed";

/** Mirrors the crop across windows so a pop-out follows the main window and vice versa. */
export function startCropSync(): () => void {
  let applyingRemote = false;
  let stopListening: (() => void) | undefined;
  let stopped = false;
  listen<string>(EVENT, ({ payload }) => {
    applyingRemote = true;
    useCrop.getState().setCrop(payload);
    applyingRemote = false;
  }).then((unlisten) => { if (stopped) unlisten(); else stopListening = unlisten; }).catch(() => undefined);
  const unsubscribe = useCrop.subscribe((state, previous) => {
    if (!applyingRemote && state.crop !== previous.crop) void emit(EVENT, state.crop).catch(() => undefined);
  });
  return () => { stopped = true; unsubscribe(); stopListening?.(); };
}
