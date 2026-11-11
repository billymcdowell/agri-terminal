import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { listCalendarEvents, subscribeToAlerts, subscribeToDataUpdates, subscribeToRiverAlerts } from "@/lib/ipc";
import { useUnits } from "@/lib/units";
import { alertNotification } from "@/panels/alerts-panel";
import { usePersistedValue } from "@/state/use-persisted-list";
import { useCrop } from "./crop";
import { DEFAULT_LEAD_HOURS, describeLead, dueAlerts } from "./release-alerts";

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

/** Notifies once per release when it is within the chosen lead time, whether or not the calendar panel is open. */
export function useReleaseAlerts() {
  const [leadHours] = usePersistedValue<number>("release-alert-lead-hours", DEFAULT_LEAD_HOURS);
  useEffect(() => {
    const check = async () => {
      try {
        const events = await listCalendarEvents();
        const now = Date.now();
        const pending = dueAlerts(events, now, (id) => localStorage.getItem(SENT_PREFIX + id) !== null, leadHours);
        if (!pending.length) return;
        if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
        for (const event of pending) {
          sendNotification({ title: `${event.kind} expected ${describeLead(new Date(event.scheduledAt).getTime() - now)}`, body: event.title });
          localStorage.setItem(SENT_PREFIX + event.id, "sent");
        }
      } catch { /* The web preview has no Tauri backend or notifications. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15 * 60_000);
    return () => window.clearInterval(timer);
  }, [leadHours]);
}

/** Restores the crop on launch and saves it as it changes. */
export function useCropPersistence() {
  const [saved, save, ready] = usePersistedValue<string | null>("crop", null);
  const hydrated = useRef(false);
  useEffect(() => {
    if (!ready || hydrated.current) return;
    hydrated.current = true;
    if (saved) useCrop.getState().setCrop(saved);
  }, [ready, saved]);
  useEffect(() => useCrop.subscribe((state) => { if (hydrated.current) save(state.crop); }), [save]);
}

/** Shows a system notification whenever the backend reports that a price alert fired. */
export function useAlertNotifications() {
  const queryClient = useQueryClient();
  const units = useUnits();
  // Read when an alert arrives, so a unit change applies without re-subscribing.
  const unitsRef = useRef(units);
  unitsRef.current = units;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeToAlerts(async (alert) => {
      void queryClient.invalidateQueries({ queryKey: ["alerts"] });
      try {
        if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
        sendNotification(alertNotification(alert, unitsRef.current));
      } catch { /* The web preview has no notifications. */ }
    }).then((stop) => { if (cancelled) stop(); else unlisten = stop; }).catch(() => undefined);
    let unlistenRiver: (() => void) | undefined;
    subscribeToRiverAlerts(async (alert) => {
      void queryClient.invalidateQueries({ queryKey: ["river-alerts"] });
      try {
        if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
        sendNotification({ title: alert.title, body: alert.body });
      } catch { /* The web preview has no notifications. */ }
    }).then((stop) => { if (cancelled) stop(); else unlistenRiver = stop; }).catch(() => undefined);
    return () => { cancelled = true; unlisten?.(); unlistenRiver?.(); };
  }, [queryClient]);
}
