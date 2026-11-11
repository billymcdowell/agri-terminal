import { useQuery } from "@tanstack/react-query";
import { listCalendarEvents, type CalendarEvent } from "@/lib/ipc";
import { PanelHeader } from "./panel-header";
import { ShowAll, useShowAll } from "./show-all";

/** Reports listed before "Show all". */
const LISTED = 5;

/** Upcoming reports first, soonest first, then the past ones newest first. */
export function orderReports(events: CalendarEvent[], now: number) {
  const time = (event: CalendarEvent) => new Date(event.scheduledAt).getTime();
  const upcoming = events.filter((event) => time(event) >= now).sort((a, b) => time(a) - time(b));
  const past = events.filter((event) => time(event) < now).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past];
}

const formatWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The next scheduled reports, in local time. */
export function CalendarPanel() {
  const calendar = useQuery({ queryKey: ["report-calendar"], queryFn: listCalendarEvents });
  const events = orderReports(calendar.data ?? [], Date.now());
  const { shown, all, toggle } = useShowAll(events, LISTED);
  return (
    <div className="workspace-panel">
      <PanelHeader title="Next reports" kind="calendar" />
      {calendar.isError && <p className="panel-freshness" data-status="error">{String(calendar.error)}</p>}
      <ul className="compact-list">
        {shown.map((event) => (
          <li key={event.id} className="compact-row">
            <span className="compact-main" title={event.title}>{event.title}</span>
            <span className="compact-meta">{formatWhen(event.scheduledAt)}{event.commodity ? ` · ${event.commodity}` : ""}</span>
          </li>
        ))}
      </ul>
      <ShowAll total={events.length} limit={LISTED} all={all} onToggle={toggle} noun="reports" />
    </div>
  );
}
