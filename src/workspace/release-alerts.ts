import type { CalendarEvent } from "@/lib/ipc";

export const ALERT_LEAD_MS = 24 * 60 * 60_000;

/** Upcoming events inside the lead window that have not been announced yet. */
export function dueAlerts(events: CalendarEvent[], now: number, alreadySent: (id: string) => boolean) {
  return events.filter((event) => {
    const until = new Date(event.scheduledAt).getTime() - now;
    return until > 0 && until <= ALERT_LEAD_MS && !alreadySent(event.id);
  });
}
