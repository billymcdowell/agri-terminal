import { useEffect, useId, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getNewsForCommodity, getStoredRows, getWeatherForCommodity, listStoredSeries, subscribeToDataUpdates } from "@/lib/ipc";
import { COMMODITIES } from "@/lib/regions";
import { useSources } from "@/state/use-series";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader } from "./panel-header";
import { buildRawSources, formatCell, lastRefresh, rawColumns, totalRows, type RawSource, type RawSourceKind } from "./raw-data";

const PAGE_SIZE = 200;
/** Fields that identify the dataset, which the panel already shows above the rows. */
const OMIT: Record<RawSourceKind, string[]> = { series: ["seriesId", "sourceId", "dataset"], weather: [], news: ["commodity"] };
const NOTES: Record<RawSourceKind, string> = {
  series: "Every stored revision, newest period first, exactly as saved after parsing. Prices are in USD per bushel and times in UTC. Text records, such as the nowcast brief, are kept whole and listed newest publish first.",
  weather: "The cached forecast for the commodity's growing regions. The Weather panel refreshes it.",
  news: "The newest 100 cached headlines for the commodity. The News panel refreshes them.",
};

function stateLabel(source: RawSource) {
  if (source.status) return `${source.status.state.toUpperCase()}${source.status.enabled ? "" : " · PAUSED"}`;
  return source.kind === "series" ? "UNREGISTERED" : "CACHE";
}

/** Refetches stored rows when any source writes, including refreshes started from a pop-out window. */
function useLiveStoredData() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeToDataUpdates((ids) => {
      let seriesChanged = false;
      for (const id of ids) {
        const [prefix, commodity] = id.split(".");
        if (prefix === "weather" || prefix === "news") void queryClient.invalidateQueries({ queryKey: [prefix, commodity] });
        else seriesChanged = true;
      }
      if (!seriesChanged) return;
      void queryClient.invalidateQueries({ queryKey: ["stored-series"] });
      void queryClient.invalidateQueries({ queryKey: ["stored-rows"] });
    }).then((stop) => { if (cancelled) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { cancelled = true; unlisten?.(); };
  }, [queryClient]);
}

/** Every row each source has stored, as a table or JSON, for checking what was actually pulled. */
export function RawDataPanel({ api, params }: PanelComponentProps) {
  useLiveStoredData();
  const datasetId = useId();
  const sources = useSources();
  const stored = useQuery({ queryKey: ["stored-series"], queryFn: listStoredSeries });
  const weather = useQueries({ queries: COMMODITIES.map((commodity) => ({ queryKey: ["weather", commodity], queryFn: () => getWeatherForCommodity(commodity) })) });
  const news = useQueries({ queries: COMMODITIES.map((commodity) => ({ queryKey: ["news", commodity], queryFn: () => getNewsForCommodity(commodity) })) });
  const [view, setView] = useState<"table" | "json">("table");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [copyMessage, setCopyMessage] = useState("");

  const entries = buildRawSources(sources.data ?? [], stored.data ?? [], {
    weather: COMMODITIES.map((commodity, index) => ({ id: commodity, label: `${commodity} growing regions`, rows: weather[index].data?.forecasts.length ?? 0, lastFetchedAt: weather[index].data?.fetchedAt ?? null })),
    news: COMMODITIES.map((commodity, index) => ({ id: commodity, label: `${commodity} headlines`, rows: news[index].data?.length ?? 0, lastFetchedAt: null })),
  });
  const source = entries.find((entry) => entry.id === params.sourceId) ?? entries.find((entry) => totalRows(entry) > 0) ?? entries[0];
  const dataset = source.datasets.find((item) => item.id === params.dataset) ?? source.datasets[0];

  const storedRows = useQuery({ queryKey: ["stored-rows", dataset?.id], queryFn: () => getStoredRows(dataset!.id), enabled: source.kind === "series" && !!dataset });
  const commodityIndex = COMMODITIES.indexOf(dataset?.id ?? "");
  const rowsQuery = source.kind === "series" ? storedRows : source.kind === "weather" ? weather[commodityIndex] : news[commodityIndex];
  const rows: object[] =
    source.kind === "series" ? [...(storedRows.data?.rows ?? [])].reverse()
    : source.kind === "weather" ? weather[commodityIndex]?.data?.forecasts ?? []
    : news[commodityIndex]?.data ?? [];
  const visible = rows.slice(0, limit);
  const columns = rawColumns(visible, OMIT[source.kind]);
  const numeric = new Set(columns.filter((column) => typeof (visible[0] as Record<string, unknown> | undefined)?.[column] === "number"));

  function select(patch: { sourceId: string; dataset: string | null }) {
    setLimit(PAGE_SIZE);
    setCopyMessage("");
    api.updateParameters(patch);
  }
  function copy() {
    navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
      .then(() => setCopyMessage(`Copied ${rows.length.toLocaleString()} rows as JSON.`))
      .catch((error) => setCopyMessage(`Could not copy: ${String(error)}`));
  }

  let content;
  if (!dataset) content = <p className="panel-freshness">Nothing stored from this source yet. Its rows appear here after its first successful refresh.</p>;
  else if (rowsQuery?.isError) content = <p role="alert" className="panel-freshness" data-status="error">{String(rowsQuery.error)}</p>;
  else if (rowsQuery?.isPending) content = <p className="panel-freshness">Loading…</p>;
  else if (!rows.length) content = <p className="panel-freshness">Nothing cached for {dataset.label} yet.</p>;
  else if (view === "json") content = <pre className="raw-json">{JSON.stringify(visible, null, 2)}</pre>;
  else content = (
    <div className="raw-rows">
      <Table className="raw-table">
        <TableHeader>
          <TableRow>{columns.map((column) => <TableHead key={column} className={numeric.has(column) ? "text-right" : undefined}>{column}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => {
                const value = (row as Record<string, unknown>)[column];
                const text = formatCell(value);
                return <TableCell key={column} className={numeric.has(column) ? "text-right" : undefined} data-null={value == null || undefined} data-long={text.length > 48 || undefined}>{text}</TableCell>;
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="workspace-panel raw-data-panel">
      <PanelHeader eyebrow="RAW DATA" title="Source data" api={api} params={params} />
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Sources</CardTitle></CardHeader>
        <CardContent>
          <Table className="raw-sources">
            <TableHeader>
              <TableRow><TableHead>Source</TableHead><TableHead>State</TableHead><TableHead className="text-right">Datasets</TableHead><TableHead className="text-right">Rows</TableHead><TableHead>Last refresh</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const refreshed = lastRefresh(entry);
                const selected = entry.id === source.id;
                return (
                  <TableRow key={entry.id} data-selected={selected}>
                    <TableCell><Button size="xs" variant="ghost" aria-pressed={selected} onClick={() => select({ sourceId: entry.id, dataset: null })}>{entry.name}</Button></TableCell>
                    <TableCell>{stateLabel(entry)}</TableCell>
                    <TableCell className="text-right">{entry.datasets.filter((item) => item.rows > 0).length}</TableCell>
                    <TableCell className="text-right">{totalRows(entry).toLocaleString()}</TableCell>
                    <TableCell>{refreshed ? new Date(refreshed).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">{source.name} <span className="driver-time">{source.id}</span></CardTitle></CardHeader>
        <CardContent>
          <div className="raw-controls">
            <div className="schema-field">
              <Label htmlFor={datasetId}>Dataset</Label>
              <NativeSelect size="sm" id={datasetId} value={dataset?.id ?? ""} disabled={!dataset} onChange={(event) => select({ sourceId: source.id, dataset: event.currentTarget.value })}>
                {source.datasets.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.label} · {item.rows.toLocaleString()} rows</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="driver-actions" role="group" aria-label="View">
              <Button size="xs" variant={view === "table" ? "secondary" : "ghost"} aria-pressed={view === "table"} onClick={() => setView("table")}>Table</Button>
              <Button size="xs" variant={view === "json" ? "secondary" : "ghost"} aria-pressed={view === "json"} onClick={() => setView("json")}>JSON</Button>
              <Button size="xs" variant="ghost" disabled={!rows.length} onClick={copy}>Copy JSON</Button>
            </div>
          </div>
          {source.status?.error && <p role="alert" className="panel-freshness" data-status="error">LAST REFRESH FAILED · {source.status.error}</p>}
          {content}
          {rows.length > visible.length && (
            <div className="raw-more">
              Showing {visible.length.toLocaleString()} of {rows.length.toLocaleString()} rows
              <Button size="xs" variant="ghost" onClick={() => setLimit(limit + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, rows.length - visible.length)} more</Button>
            </div>
          )}
          {copyMessage && <p role="status" className="panel-freshness">{copyMessage}</p>}
          <p className="panel-freshness">{NOTES[source.kind]}</p>
        </CardContent>
      </Card>
    </div>
  );
}
