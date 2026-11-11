import type { CalendarEvent } from "@/lib/ipc";

export const DEFAULT_LEAD_HOURS = 24;
/** Lead times offered in settings; 0 turns release alerts off. */
export const LEAD_HOUR_OPTIONS = [0, 1, 6, 12, 24, 48] as const;

/** Upcoming events inside the lead window that have not been announced yet. */
export function dueAlerts(events: CalendarEvent[], now: number, alreadySent: (id: string) => boolean, leadHours = DEFAULT_LEAD_HOURS) {
  if (leadHours <= 0) return [];
  const leadMs = leadHours * 60 * 60_000;
  return events.filter((event) => {
    const until = new Date(event.scheduledAt).getTime() - now;
    return until > 0 && until <= leadMs && !alreadySent(event.id);
  });
}

/** How far away a release is, in words that stay true for the next few minutes. */
export function describeLead(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}
