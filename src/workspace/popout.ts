import type { PanelParams } from "./types";

const PARAM = "popout";

export function popoutUrl(path: string, params: PanelParams): string {
  return `${path}?${PARAM}=${encodeURIComponent(JSON.stringify(params))}`;
}

/** Reads the panel a pop-out window should show, or null for the main window. */
export function readPopout(search: string): PanelParams | null {
  const raw = new URLSearchParams(search).get(PARAM);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PanelParams>;
    return typeof value.kind === "string" ? (value as PanelParams) : null;
  } catch {
    return null;
  }
}

/** Opens the panel in a second window. Outside Tauri (web preview) it falls back to a browser popup. */
export async function openPopout(params: PanelParams, title: string): Promise<void> {
  const url = popoutUrl(window.location.pathname.endsWith(".html") ? window.location.pathname.split("/").pop()! : "index.html", params);
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const popout = new WebviewWindow(`popout-${crypto.randomUUID()}`, { url, title, width: 900, height: 640 });
    await new Promise<void>((resolve, reject) => {
      void popout.once("tauri://created", () => resolve());
      void popout.once("tauri://error", (event) => reject(new Error(String(event.payload))));
    });
  } catch (error) {
    if (!window.open(url, "_blank", "popup,width=900,height=640")) throw error;
  }
}
