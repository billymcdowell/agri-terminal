import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCalendarEvents } from "@/lib/ipc";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader } from "./panel-header";

export function CalendarPanel({ api, params }: PanelComponentProps) {
  const calendar = useQuery({ queryKey: ["report-calendar"], queryFn: listCalendarEvents });
  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow="RELEASE SCHEDULE" title="Report calendar" api={api} params={params} />
      <Card className="terminal-card">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Expected release</TableHead><TableHead>Report</TableHead><TableHead>Contracts</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {calendar.data?.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>{new Date(event.scheduledAt).toLocaleString()}</TableCell>
                  <TableCell>{event.title}</TableCell>
                  <TableCell>{event.commodity ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="panel-freshness">Expected windows from the maintained local schedule. Verify release dates against agency calendars.</p>
        </CardContent>
      </Card>
    </div>
  );
}
