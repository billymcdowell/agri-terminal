import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  RiBarChart2Line,
  RiCalendarEventLine,
  RiDashboardLine,
  RiLeafLine,
  RiNewspaperLine,
  RiRefreshLine,
  RiSettings3Line,
} from "@remixicon/react";
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
import { PriceChart } from "@/panels/price-chart";
import { refreshSource } from "@/lib/ipc";
import { useSeries, useSources } from "@/state/use-series";

const SERIES_ID = "price.ZC.close";
const RANGES = ["1M", "3M", "1Y", "ALL"] as const;

function formatAge(timestamp: string, now: number) {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now - new Date(timestamp).getTime()) / 60_000),
  );
  if (elapsedMinutes < 60) return `${elapsedMinutes}m old`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h old`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ${elapsedHours % 24}h old`;
}

function App() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const series = useSeries(SERIES_ID);
  const sources = useSources();

  const allBars = series.data ?? [];
  const bars = useMemo(() => {
    if (range === "ALL" || allBars.length === 0) return allBars;
    const days = range === "1M" ? 31 : range === "3M" ? 93 : 366;
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshSource("fixture-corn");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["series", SERIES_ID] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
    } catch {
      // The chart remains available from SQLite while the bridge is unavailable.
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="terminal-shell dark">
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
        <nav className="rail" aria-label="Main navigation">
          <Button
            className="rail-button active"
            size="icon"
            variant="ghost"
            aria-label="Workspace"
          >
            <RiDashboardLine />
          </Button>
          <Button
            className="rail-button"
            size="icon"
            variant="ghost"
            aria-label="Charts"
          >
            <RiBarChart2Line />
          </Button>
          <Button
            className="rail-button"
            size="icon"
            variant="ghost"
            aria-label="Crops"
          >
            <RiLeafLine />
          </Button>
          <Button
            className="rail-button"
            size="icon"
            variant="ghost"
            aria-label="Calendar"
          >
            <RiCalendarEventLine />
          </Button>
          <Button
            className="rail-button"
            size="icon"
            variant="ghost"
            aria-label="News"
          >
            <RiNewspaperLine />
          </Button>
          <div className="mt-auto">
            <Button
              className="rail-button"
              size="icon"
              variant="ghost"
              aria-label="Settings"
            >
              <RiSettings3Line />
            </Button>
          </div>
        </nav>

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
                Reload cached
              </Button>
              <Button variant="secondary" size="sm">
                Add panel
              </Button>
            </div>
          </div>

          <div className="content-grid">
            <Card className="terminal-card chart-card">
              <CardHeader>
                <div className="chart-card-head">
                  <div>
                    <div className="chart-instrument">
                      <span className="instrument-symbol">ZC · CORN</span>
                      <Badge variant="outline">SIMULATED</Badge>
                      <Badge variant="secondary">DAILY</Badge>
                    </div>
                    <div className="instrument-name">
                      Corn · synthetic demonstration series
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
                            USD / bu
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="chart-meta-row">
                  <span>OHLC · Daily sample</span>
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
                    <PriceChart bars={bars} />
                  </div>
                ) : (
                  <Empty className="empty-chart">
                    <EmptyHeader>
                      <EmptyTitle>No price observations yet</EmptyTitle>
                      <EmptyDescription>
                        Once a source has written prices to local storage, the
                        chart will appear here.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
                <div className="chart-footer">
                  <span className="freshness">
                    <i className="freshness-dot" />
                    {latest
                      ? `STALE DEMO FIXTURE · ${latest.sourceId} · ${formatAge(latest.releasedAt, now)}`
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
                    Latest sample close. This is not a market quote.
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="metric-label">Last close</div>
                  <div className="metric-value">
                    {latest ? `$${latest.close.toFixed(2)}` : "—"}
                    <span className="ml-1 text-xs text-muted-foreground">
                      /bu
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
                        {fixtureSource?.name ?? "Corn price fixture"}
                      </div>
                      <div className="source-detail">
                        {fixtureSource?.isDemo
                          ? "Recorded sample data"
                          : "Source status unavailable"}
                      </div>
                    </div>
                    <Badge variant="outline">DEMO</Badge>
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
                        Fixture · no API key required
                      </div>
                    </div>
                    <Badge variant="outline">LOCAL</Badge>
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
            STALE DEMO DATA
          </span>
          <span>OFFLINE READY</span>
          <span>OBSERVATIONS {allBars.length.toString().padStart(3, "0")}</span>
        </div>
        <div className="status-right">
          <span>LOCAL · SQLITE</span>
          <span>AG TERMINAL / 0.1</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
