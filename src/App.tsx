import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RiRefreshLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PriceChart, type MoveMarker } from "@/panels/price-chart";
import {
  explainMoves,
  getDatabentoKeyStatus,
  getSecretStatus,
  refreshSource,
  saveSecret,
  saveDatabentoKey,
  setSourceEnabled,
  testConnection,
  type SourceStatus,
} from "@/lib/ipc";
import { formatAge } from "@/lib/freshness";
import { toDisplayPrice, UNIT_LABELS, useUnits } from "@/lib/units";
import { useSeries, useSources } from "@/state/use-series";
import { WorkspaceShell } from "@/workspace/shell";

const COMMODITY_NAMES: Record<string, string> = { ZC: "Corn", ZS: "Soybeans", ZW: "Wheat" };
const RANGES = ["1W", "1M", "ALL"] as const;

function SourceControl({ source }: { source: SourceStatus }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const needsKey = ["usda-nass", "usda-fas"].includes(source.sourceId);
  const keyStatus = useQuery({ queryKey: ["secret-status", source.sourceId], queryFn: () => getSecretStatus(source.sourceId), enabled: needsKey });
  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); setMessage(success); await queryClient.invalidateQueries({ queryKey: ["sources"] }); await queryClient.invalidateQueries({ queryKey: ["secret-status", source.sourceId] }); }
    catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  return <div className="source-control"><div className="source-control-heading"><div><div className="source-name">{source.name}</div><div className="source-detail">{source.state.toUpperCase()} · {source.lastOk ? `Updated ${new Date(source.lastOk).toLocaleString()}` : "Never refreshed"}{source.nextExpected ? ` · Next ${new Date(source.nextExpected).toLocaleString()}` : ""}</div></div><Badge variant={source.enabled ? "secondary" : "outline"}>{source.enabled ? "ENABLED" : "PAUSED"}</Badge></div>{needsKey && <div className="source-control-key"><Input aria-label={`${source.name} API key`} type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={keyStatus.data ? "Saved in OS keychain · replace key" : "API key · stored in OS keychain"} /><Button size="sm" variant="outline" disabled={!key.trim() || busy} onClick={() => void perform(async () => { await saveSecret(source.sourceId, key); setKey(""); }, "Key saved in OS keychain.")}>Save key</Button></div>}<div className="source-control-actions"><Button size="xs" variant="ghost" disabled={busy || !source.enabled} onClick={() => void perform(() => testConnection(source.sourceId), "Connection successful.")}>Test connection</Button><Button size="xs" variant="ghost" disabled={busy || !source.enabled} onClick={() => void perform(() => refreshSource(source.sourceId), "Source refreshed.")}>Refresh now</Button><Button size="xs" variant="ghost" onClick={() => void perform(() => setSourceEnabled(source.sourceId, !source.enabled), source.enabled ? "Source paused." : "Source enabled.")}>{source.enabled ? "Pause" : "Enable"}</Button></div>{(source.error || message) && <p className="source-dialog-error">{message || source.error}</p>}</div>;
}

export function MarketOverview({ commodity }: { commodity: string }) {
  const commodityName = COMMODITY_NAMES[commodity] ?? commodity;
  const seriesId = `price.${commodity}.close`;
  const [range, setRange] = useState<(typeof RANGES)[number]>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const queryClient = useQueryClient();
  const series = useSeries(seriesId);
  const sources = useSources();
  const keyStatus = useQuery({
    queryKey: ["databento-key-status"],
    queryFn: getDatabentoKeyStatus,
    staleTime: 60_000,
  });

  const moves = useQuery({
    queryKey: ["moves", commodity, 2],
    queryFn: () => explainMoves(commodity, 2),
  });
  const markers = useMemo<MoveMarker[]>(
    () =>
      (moves.data ?? []).map((item) => ({
        date: item.move.date,
        direction: item.move.logReturn >= 0 ? "up" : "down",
        text: `${Math.abs(item.move.zScore).toFixed(1)} SD`,
      })),
    [moves.data],
  );

  const units = useUnits();
  const allBars = useMemo(
    () =>
      (series.data ?? []).map((bar) => ({
        ...bar,
        open: toDisplayPrice(bar.open, commodity, units),
        high: toDisplayPrice(bar.high, commodity, units),
        low: toDisplayPrice(bar.low, commodity, units),
        close: toDisplayPrice(bar.close, commodity, units),
      })),
    [series.data, commodity, units],
  );
  const bars = useMemo(() => {
    if (range === "ALL" || allBars.length === 0) return allBars;
    const days = range === "1W" ? 7 : 31;
    const lastDate = new Date(
      `${allBars[allBars.length - 1].period}T00:00:00Z`,
    );
    lastDate.setUTCDate(lastDate.getUTCDate() - days);
    const cutoff = lastDate.toISOString().slice(0, 10);
    return allBars.filter((bar) => bar.period >= cutoff);
  }, [allBars, range]);

  const latest = allBars[allBars.length - 1];
  const prior = allBars[allBars.length - 2];
  const delta = latest && prior ? latest.close - prior.close : 0;
  const deltaPercent = prior ? (delta / prior.close) * 100 : 0;
  const fixtureSource = sources.data?.find(
    (source) => source.sourceId === "fixture-corn",
  );
  const databentoSource = sources.data?.find(
    (source) => source.sourceId === "databento",
  );
  const isDemo = latest !== undefined && latest.sourceId !== "databento";
  const ageMs = latest ? now - new Date(latest.fetchedAt).getTime() : 0;
  const isStale = isDemo || ageMs > 36 * 60 * 60 * 1000;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    setRefreshing(true);
    setSourceError("");
    try {
      await refreshSource(keyStatus.data ? "databento" : "fixture-corn");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["series", seriesId] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
    } catch (error) {
      setSourceError(String(error));
      setSourcesOpen(true);
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    } finally {
      setRefreshing(false);
    }
  }

  async function storeApiKey() {
    setSavingKey(true);
    setSourceError("");
    setSourceMessage("");
    try {
      await saveDatabentoKey(apiKey);
      setApiKey("");
      await queryClient.invalidateQueries({
        queryKey: ["databento-key-status"],
      });
      setSourceMessage("API key saved in the operating system keychain.");
    } catch (error) {
      setSourceError(String(error));
    } finally {
      setSavingKey(false);
    }
  }

  return (
    <div className="terminal-shell">
      <header className="terminal-topbar">
        <div className="brand-lockup">
          <div className="brand-mark">AT</div>
          <div>
            <span className="brand-name">AgriTerminal</span>
            <span className="brand-meta">MARKET DESK</span>
          </div>
        </div>
        <div className="topbar-center">Grains &amp; oilseeds</div>
        <div className="topbar-right">
          <span>
            <i className="connection-dot" />
            LOCAL DATABASE
          </span>
          <span>DEMO WORKSPACE</span>
        </div>
      </header>

      <div className="terminal-main">
        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">Workspace / Overview</div>
              <h1 className="page-title">Market overview</h1>
            </div>
            <div className="workspace-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={refreshing}
              >
                <RiRefreshLine className={refreshing ? "animate-spin" : ""} />
                {keyStatus.data ? "Refresh prices" : "Reload cached"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSourcesOpen(true)}
              >
                Data sources
              </Button>
            </div>
          </div>

          <div className="content-grid">
            <Card className="terminal-card chart-card">
              <CardHeader>
                <div className="chart-card-head">
                  <div>
                    <div className="chart-instrument">
                      <span className="instrument-symbol">{commodity} · {commodityName.toUpperCase()}</span>
                      <Badge variant="outline">
                        {isDemo ? "SIMULATED" : "CBOT"}
                      </Badge>
                      <Badge variant="secondary">DAILY</Badge>
                    </div>
                    <div className="instrument-name">
                      {isDemo
                        ? `${commodityName} · synthetic demonstration series`
                        : `${commodityName} futures · continuous front month`}
                    </div>
                  </div>
                  <div className="chart-price">
                    {series.isLoading ? (
                      <Skeleton className="h-7 w-24" />
                    ) : (
                      <>
                        <div className="price-value">
                          {latest ? `$${latest.close.toFixed(2)}` : "—"}
                        </div>
                        <div className="price-change">
                          {latest
                            ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} (${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(2)}%)`
                            : "Awaiting data"}
                          <span className="ml-2 text-muted-foreground">
                            {UNIT_LABELS[units].replace("/", " / ")}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="chart-meta-row">
                  <span>
                    {isDemo ? "OHLC · Daily sample" : "OHLC · Daily bars"}
                  </span>
                  <div className="range-switcher" aria-label="Chart range">
                    {RANGES.map((item) => (
                      <Button
                        key={item}
                        size="xs"
                        variant="ghost"
                        className={`range-button ${range === item ? "selected" : ""}`}
                        aria-pressed={range === item}
                        onClick={() => setRange(item)}
                      >
                        {item}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {series.isLoading ? (
                  <Skeleton className="chart-container rounded-md" />
                ) : series.isError ? (
                  <Empty className="empty-chart">
                    <EmptyHeader>
                      <EmptyTitle>Price data is unavailable</EmptyTitle>
                      <EmptyDescription>
                        AgriTerminal could not reach its local database. Try
                        refreshing the connection.
                      </EmptyDescription>
                    </EmptyHeader>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void series.refetch()}
                    >
                      Retry
                    </Button>
                  </Empty>
                ) : bars.length > 0 ? (
                  <div className="chart-container">
                    <PriceChart bars={bars} markers={markers} />
                  </div>
                ) : (
                  <Empty className="empty-chart">
                    <EmptyHeader>
                      <EmptyTitle>No {commodityName.toLowerCase()} prices yet</EmptyTitle>
                      <EmptyDescription>
                        {keyStatus.data
                          ? "Use Refresh prices to load daily bars into local storage."
                          : "Add a Databento key under Data sources to load daily bars. Only the corn demonstration series works without a key."}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
                <div className="chart-footer">
                  <span className="freshness">
                    <i
                      className={`freshness-dot ${isStale ? "stale" : "fresh"}`}
                    />
                    {latest
                      ? `${isStale ? "STALE" : "FRESH"}${isDemo ? " DEMO FIXTURE" : ""} · ${latest.sourceId} · ${formatAge(latest.fetchedAt, now)}`
                      : "Waiting for local observations"}
                  </span>
                  <span>{allBars.length} observations · cached locally</span>
                </div>
              </CardContent>
            </Card>

            <aside className="side-stack">
              <Card className="terminal-card" size="sm">
                <CardHeader>
                  <CardTitle className="side-card-title">
                    Market snapshot
                  </CardTitle>
                  <div className="side-card-subtitle">
                    {isDemo
                      ? "Latest sample close. This is not a market quote."
                      : "Latest available corn futures daily bar from Databento."}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="metric-label">Last close</div>
                  <div className="metric-value">
                    {latest ? `$${latest.close.toFixed(2)}` : "—"}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {UNIT_LABELS[units].slice(3)}
                    </span>
                  </div>
                  <div className="metric-foot">
                    {latest
                      ? new Date(
                          `${latest.period}T12:00:00Z`,
                        ).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                      : "No observations"}
                  </div>
                  <div className="source-row">
                    <div>
                      <div className="source-name">
                        {isDemo
                          ? (fixtureSource?.name ?? "Corn price fixture")
                          : (databentoSource?.name ?? "Databento")}
                      </div>
                      <div className="source-detail">
                        {isDemo
                          ? "Synthetic sample data"
                          : "Licensed provider · cached locally"}
                      </div>
                    </div>
                    <Badge variant="outline">{!latest ? "NO DATA" : isDemo ? "DEMO" : "LIVE"}</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="terminal-card" size="sm">
                <CardHeader>
                  <CardTitle className="side-card-title">
                    Data integrity
                  </CardTitle>
                  <div className="side-card-subtitle">
                    Every bar keeps its source, release time, fetch time and
                    revision.
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="source-row !mt-0 !pt-0 !border-0">
                    <div>
                      <div className="source-name">SQLite cache</div>
                      <div className="source-detail">Offline-first storage</div>
                    </div>
                    <Badge variant="secondary">READY</Badge>
                  </div>
                  <div className="source-row">
                    <div>
                      <div className="source-name">Price source</div>
                      <div className="source-detail">
                        {isDemo
                          ? "Fixture · no API key required"
                          : "Databento · daily bars"}
                      </div>
                    </div>
                    <Badge variant="outline">
                      {isDemo ? "LOCAL" : "SYNCED"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </aside>
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <div className="status-left">
          <span className="status-pill">
            <i className="connection-dot" />
            {isDemo
              ? "STALE DEMO DATA"
              : isStale
                ? "STALE MARKET DATA"
                : "MARKET DATA CURRENT"}
          </span>
          <span>OFFLINE READY</span>
          <span>OBSERVATIONS {allBars.length.toString().padStart(3, "0")}</span>
        </div>
        <div className="status-right">
          <span>LOCAL · SQLITE</span>
          <span>AG TERMINAL / 0.1</span>
        </div>
      </footer>

      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Data sources</DialogTitle>
            <DialogDescription>
              Futures prices are requested from Databento with your own key. The
              key stays in the operating system keychain.
            </DialogDescription>
          </DialogHeader>
          <div className="source-dialog-section">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="source-name">Databento · GLBX.MDP3</div>
                <div className="source-detail">
                  {keyStatus.data ? "Key saved" : "No key saved"}
                  {databentoSource?.lastOk
                    ? ` · Updated ${formatAge(databentoSource.lastOk, now)}`
                    : ""}
                </div>
              </div>
              <Badge variant={keyStatus.data ? "secondary" : "outline"}>
                {keyStatus.data ? "READY" : "OPTIONAL"}
              </Badge>
            </div>
            {databentoSource?.error && (
              <p className="source-dialog-error">{databentoSource.error}</p>
            )}
            <div className="mt-4 grid gap-2">
              <Label htmlFor="databento-key">API key</Label>
              <Input
                id="databento-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={
                  keyStatus.data
                    ? "Enter a replacement key"
                    : "Paste your Databento key"
                }
                onChange={(event) => setApiKey(event.currentTarget.value)}
              />
              <p className="source-dialog-note">
                Refresh requests 30 days of daily bars, and a background update
                runs every 24 hours after a key is saved. Databento usage
                charges may apply. Synthetic sample data remains available
                offline.
              </p>
            </div>
            {sourceMessage && (
              <p className="source-dialog-success">{sourceMessage}</p>
            )}
            {sourceError && (
              <p className="source-dialog-error">{sourceError}</p>
            )}
          </div>
          <div className="source-controls-list">
            {sources.data?.filter((source) => !["databento", "fixture-corn"].includes(source.sourceId)).map((source) => <SourceControl key={source.sourceId} source={source} />)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSourcesOpen(false)}>
              Close
            </Button>
            <Button
              onClick={storeApiKey}
              disabled={!apiKey.trim() || savingKey}
            >
              {savingKey ? "Saving…" : "Save key"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void refresh()}
              disabled={!keyStatus.data || refreshing}
            >
              {refreshing ? "Loading…" : "Load prices"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function App() {
  return <WorkspaceShell MarketOverview={MarketOverview} />;
}
