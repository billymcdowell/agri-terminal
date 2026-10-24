import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { listCalendarEvents, subscribeToDataUpdates } from "@/lib/ipc";
import { dueAlerts } from "./release-alerts";

const SENT_PREFIX = "report-alert:";

/** Invalidates cached queries when the backend reports new data, so open panels refresh on their own. */
export function useDataUpdateInvalidation() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeToDataUpdates((seriesIds) => {
      for (const id of seriesIds) {
        const [head, commodity] = id.split(".");
        if (head === "weather" || head === "news") void queryClient.invalidateQueries({ queryKey: [head, commodity] });
        else void queryClient.invalidateQueries({ queryKey: ["metric-series", id] });
      }
      // Combined views and flagged moves are derived from the series above.
      void queryClient.invalidateQueries({ queryKey: ["crop-stress"] });
      void queryClient.invalidateQueries({ queryKey: ["moves"] });
    }).then((stop) => { if (cancelled) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { cancelled = true; unlisten?.(); };
  }, [queryClient]);
}

/** Notifies once per release when it is due within 24 hours, whether or not the calendar panel is open. */
export function useReleaseAlerts() {
  useEffect(() => {
    const check = async () => {
      try {
        const events = await listCalendarEvents();
        const pending = dueAlerts(events, Date.now(), (id) => localStorage.getItem(SENT_PREFIX + id) !== null);
        if (!pending.length) return;
        if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
        for (const event of pending) {
          sendNotification({ title: `${event.kind} expected within 24 hours`, body: event.title });
          localStorage.setItem(SENT_PREFIX + event.id, "sent");
        }
      } catch { /* The web preview has no Tauri backend or notifications. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
}
