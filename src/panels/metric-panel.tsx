import { useEffect, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { classifyFreshness } from "@/lib/freshness";
import { findRegion } from "@/lib/regions";
import { percentileRank } from "@/lib/stats";
import { getMetricSeries } from "@/lib/ipc";
import { useSources } from "@/state/use-series";
import { useCrop } from "@/shell/crop";
import { PanelHeader } from "./panel-header";
import { balanceSheetRows, cotRows, cropConditionRows, droughtRows, type MetricRow } from "./series";

export type MetricPanelKind = "cot" | "crop-condition" | "wasde" | "drought";

const DEFINITIONS: Record<MetricPanelKind, { title: (commodity: string, region: string) => string; sourceId: string; rows: (commodity: string, stateId: string) => MetricRow[] }> = {
  cot: { title: (c) => `Commitments of Traders · ${c}`, sourceId: "cftc-cot", rows: (c) => cotRows(c) },
  "crop-condition": { title: (c) => `Crop condition · ${c}`, sourceId: "usda-nass", rows: (c) => cropConditionRows(c) },
  wasde: { title: (c) => `Balance sheet · ${c}`, sourceId: "usda-fas", rows: (c) => balanceSheetRows(c) },
  drought: { title: (_, region) => `Drought Monitor · ${region}`, sourceId: "us-drought-monitor", rows: (_, stateId) => droughtRows(stateId) },
};

/** One table of the latest observation per series, with source-aware freshness beneath it. `region` is the state the Drought Monitor shows; the other kinds follow the crop. */
export function MetricPanel({ kind, region: regionId, controls }: { kind: MetricPanelKind; region?: string; controls?: ReactNode }) {
  const definition = DEFINITIONS[kind];
  const commodity = useCrop((state) => state.crop);
  const region = findRegion(regionId) ?? findRegion("ia")!;
  const rows = definition.rows(commodity, region.id);
  const queries = useQueries({ queries: rows.map((row) => ({ queryKey: ["metric-series", row.seriesId], queryFn: () => getMetricSeries(row.seriesId), staleTime: 60_000 })) });
  const source = useSources().data?.find((item) => item.sourceId === definition.sourceId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const lines = rows.map((row, index) => {
    const history = queries[index].data ?? [];
    const latest = history[history.length - 1];
    const percentile = kind === "cot" && latest ? percentileRank(history.map((point) => point.value), latest.value) : undefined;
    return { ...row, latest, percentile, isError: queries[index].isError, isLoading: queries[index].isPending };
  });
  const hasData = lines.some((line) => line.latest);
  const freshness = classifyFreshness({
    lastConfirmedAt: source?.lastOk ?? lines.find((line) => line.latest)?.latest?.fetchedAt,
    cadenceSeconds: source?.cadenceSeconds ?? 604_800,
    sourceState: source?.state,
    hasData,
    now,
  });

  return (
    <div className="workspace-panel">
      <PanelHeader title={definition.title(commodity, region.name)} kind={kind} controls={controls} />
      <Card className="terminal-card">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Series</TableHead>
                <TableHead className="text-right">Value</TableHead>
                {kind === "cot" && <TableHead className="text-right">Percentile</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.seriesId}>
                  <TableCell>
                    <span className="metric-label">{line.label}</span>
                    {line.latest && <span className="metric-when">{line.latest.period} · released {new Date(line.latest.releasedAt).toLocaleDateString()}</span>}
                  </TableCell>
                  <TableCell className="text-right">{line.latest ? `${line.latest.value.toLocaleString()} ${line.latest.unit}` : line.isError ? "Unavailable" : line.isLoading ? "Loading…" : "No cached data"}</TableCell>
                  {kind === "cot" && <TableCell className="text-right">{line.percentile === undefined ? "—" : `${line.percentile}th`}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="panel-freshness" role="status" data-status={freshness.status}>
            {freshness.label}{source ? ` · ${source.name}` : ""}
            {source?.error ? ` · ${source.error}` : ""}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
