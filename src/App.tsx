import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RiRefreshLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { AboutButton, PanelAbout } from "@/panels/panel-guide";
import { PriceChart, type MoveMarker } from "@/panels/price-chart";
import { explainMoves, getSecretStatus, refreshSource } from "@/lib/ipc";
import { CROP_NAMES } from "@/lib/regions";
import { toDisplayPrice, UNIT_LABELS, useUnits } from "@/lib/units";
import { priceStatus } from "@/panels/price-status";
import { useSettingsScreen } from "@/settings/use-settings-screen";
import { useSeries, useSources } from "@/state/use-series";
import { WorkspaceShell } from "@/workspace/shell";

/** The only commodity with a demonstration series, so the only one that has prices without a key. */
const DEMO_COMMODITY = "ZC";
/** The futures price source; its key is stored under this id like the other source keys. */
const PRICE_SOURCE = "massive";
const RANGES = ["1W", "1M", "ALL"] as const;

export function MarketOverview({ commodity }: { commodity: string }) {
  const commodityName = CROP_NAMES[commodity] ?? commodity;
  const seriesId = `price.${commodity}.close`;
  const [range, setRange] = useState<(typeof RANGES)[number]>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [aboutOpen, setAboutOpen] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const showSources = () => useSettingsScreen.getState().show("sources");
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
    setRefreshError("");
    try {
      await refreshSource(keyStatus.data ? PRICE_SOURCE : "fixture-corn");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["series", seriesId] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
    } catch (error) {
      setRefreshError(String(error));
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    } finally {
      setRefreshing(false);
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
        <Button variant="outline" size="sm" disabled={refreshing} onClick={canRefresh ? () => void refresh() : showSources}>
          {canRefresh && <RiRefreshLine className={refreshing ? "animate-spin" : ""} />}
          {keyStatus.data ? "Load prices" : canRefresh ? "Load sample prices" : "Add a Massive key"}
        </Button>
        {refreshError && <p role="alert" className="source-error">{refreshError}</p>}
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
          <Button size="xs" variant="outline" onClick={showSources}>Add key</Button>
        </div>
      )}
      <div className="market-chart">{chart}</div>
      {status.origin === "live" && (
        <div className="market-footer">
          <span role="status" data-status={status.freshness.status}>
            <i className="freshness-dot" aria-hidden="true" />
            {status.freshness.label} · {status.provider}
          </span>
          <Button size="xs" variant="ghost" onClick={showSources}>Data sources</Button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return <WorkspaceShell MarketOverview={MarketOverview} />;
}
