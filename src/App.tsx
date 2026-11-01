import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RiRefreshLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { AboutButton, PanelAbout } from "@/panels/panel-guide";
import { PriceChart, type MoveMarker } from "@/panels/price-chart";
import {
  explainMoves,
  getSecretStatus,
  refreshSource,
  saveSecret,
  setSourceEnabled,
  testConnection,
  type SourceStatus,
} from "@/lib/ipc";
import { formatAge } from "@/lib/freshness";
import { toDisplayPrice, UNIT_LABELS, useUnits } from "@/lib/units";
import { priceStatus } from "@/panels/price-status";
import { useSeries, useSources } from "@/state/use-series";
import { WorkspaceShell } from "@/workspace/shell";

const COMMODITY_NAMES: Record<string, string> = { ZC: "Corn", ZS: "Soybeans", ZW: "Wheat" };
/** The only commodity with a demonstration series, so the only one that has prices without a key. */
const DEMO_COMMODITY = "ZC";
/** The futures price source; its key is stored under this id like the other source keys. */
const PRICE_SOURCE = "massive";
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const queryClient = useQueryClient();
  const series = useSeries(seriesId);
  const sources = useSources();
  const keyStatus = useQuery({
    queryKey: ["secret-status", PRICE_SOURCE],
    queryFn: () => getSecretStatus(PRICE_SOURCE),
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
  const priceSource = sources.data?.find(
    (source) => source.sourceId === PRICE_SOURCE,
  );
  const status = priceStatus({ latest, priceSource, now });
  // Without a key only the demonstration series can be reloaded; other commodities need a key first.
  const canRefresh = !!keyStatus.data || commodity === DEMO_COMMODITY;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    setRefreshing(true);
    setSourceError("");
    try {
      await refreshSource(keyStatus.data ? PRICE_SOURCE : "fixture-corn");
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
      await saveSecret(PRICE_SOURCE, apiKey);
      setApiKey("");
      await queryClient.invalidateQueries({
        queryKey: ["secret-status", PRICE_SOURCE],
      });
      setSourceMessage("API key saved in the operating system keychain.");
    } catch (error) {
      setSourceError(String(error));
    } finally {
      setSavingKey(false);
    }
  }

  let chart;
  if (series.isLoading) chart = <Skeleton className="h-full w-full rounded-md" />;
  else if (series.isError) {
    chart = (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>Price data is unavailable</EmptyTitle>
          <EmptyDescription>AgriTerminal could not reach its local database.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={() => void series.refetch()}>Retry</Button>
      </Empty>
    );
  } else if (bars.length > 0) chart = <PriceChart bars={bars} markers={markers} />;
  else {
    chart = (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>No {commodityName.toLowerCase()} prices yet</EmptyTitle>
          <EmptyDescription>
            {keyStatus.data
              ? "Load daily bars from Massive into local storage."
              : canRefresh
                ? "Load the sample corn prices, or add a free Massive key to see real ones."
                : "Add a free Massive key to load daily bars. Only corn has sample prices without a key."}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={canRefresh ? () => void refresh() : () => setSourcesOpen(true)}>
          {canRefresh && <RiRefreshLine className={refreshing ? "animate-spin" : ""} />}
          {keyStatus.data ? "Load prices" : canRefresh ? "Load sample prices" : "Add a Massive key"}
        </Button>
      </Empty>
    );
  }

  return (
    <div className="workspace-panel market-panel">
      <div className="market-head">
        <div className="market-quote">
          <h2 title={`${commodity} futures on the Chicago Board of Trade`}>{commodityName}</h2>
          {series.isLoading ? (
            <Skeleton className="h-6 w-40" />
          ) : latest && (
            <>
              <span className="price-value">${latest.close.toFixed(2)}</span>
              {prior && (
                <span className="price-change" data-direction={delta >= 0 ? "up" : "down"}>
                  {delta >= 0 ? "+" : ""}{delta.toFixed(2)} ({deltaPercent >= 0 ? "+" : ""}{deltaPercent.toFixed(2)}%)
                </span>
              )}
              <span className="price-unit">{UNIT_LABELS[units]}</span>
            </>
          )}
        </div>
        <div className="market-tools">
          <div className="range-switcher" role="group" aria-label="Chart range">
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
          <AboutButton open={aboutOpen} onToggle={() => setAboutOpen((open) => !open)} />
        </div>
      </div>
      {aboutOpen && <PanelAbout kind="market" />}
      {status.origin === "demo" && (
        <div className="market-banner" role="status">
          <span>Showing sample corn prices, not market quotes. Add a free Massive key to see real prices.</span>
          <Button size="xs" variant="outline" onClick={() => setSourcesOpen(true)}>Add key</Button>
        </div>
      )}
      <div className="market-chart">{chart}</div>
      {status.origin === "live" && (
        <div className="market-footer">
          <span role="status" data-status={status.freshness.status}>
            <i className="freshness-dot" aria-hidden="true" />
            {status.freshness.label} · {status.provider}
          </span>
          <Button size="xs" variant="ghost" onClick={() => setSourcesOpen(true)}>Data sources</Button>
        </div>
      )}

      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Data sources</DialogTitle>
            <DialogDescription>
              Futures prices are requested from Massive with your own key. The
              key stays in the operating system keychain.
            </DialogDescription>
          </DialogHeader>
          <div className="source-dialog-section">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="source-name">{priceSource?.name ?? "Massive · CBOT futures"}</div>
                <div className="source-detail">
                  {keyStatus.data ? "Key saved" : "No key saved"}
                  {priceSource?.lastOk
                    ? ` · Updated ${formatAge(priceSource.lastOk, now)}`
                    : ""}
                </div>
              </div>
              <Badge variant={keyStatus.data ? "secondary" : "outline"}>
                {keyStatus.data ? "READY" : "OPTIONAL"}
              </Badge>
            </div>
            {priceSource?.error && (
              <p className="source-dialog-error">{priceSource.error}</p>
            )}
            <div className="mt-4 grid gap-2">
              <Label htmlFor="massive-key">API key</Label>
              <Input
                id="massive-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={
                  keyStatus.data
                    ? "Enter a replacement key"
                    : "Paste your Massive key"
                }
                onChange={(event) => setApiKey(event.currentTarget.value)}
              />
              <p className="source-dialog-note">
                Refresh requests 30 days of daily bars, and a background update
                runs every 24 hours after a key is saved. The free Futures
                Basic plan is enough; it allows five requests a minute, so a
                refresh takes about a minute. Synthetic sample data remains
                available offline.
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
            {sources.data?.filter((source) => ![PRICE_SOURCE, "fixture-corn"].includes(source.sourceId)).map((source) => <SourceControl key={source.sourceId} source={source} />)}
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
