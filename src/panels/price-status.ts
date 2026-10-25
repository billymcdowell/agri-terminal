import { classifyFreshness, formatAge, type Freshness } from "@/lib/freshness";
import type { PriceBar, SourceStatus } from "@/lib/ipc";

const DAY_SECONDS = 86_400;

/** Where the chart's prices come from: Databento bars, the corn demonstration fixture, or nothing yet. */
export type PriceOrigin = "live" | "demo" | "none";

export type PriceStatus = {
  origin: PriceOrigin;
  badge: string;
  description: string;
  snapshotNote: string;
  freshness: Freshness;
  statusBar: string;
};

type PriceStatusInput = {
  commodityName: string;
  latest?: Pick<PriceBar, "sourceId" | "fetchedAt">;
  hasKey: boolean;
  databento?: Pick<SourceStatus, "lastOk" | "state" | "cadenceSeconds">;
  now: number;
};

/** Labels for the price panel. Only Databento bars are described as market data. */
export function priceStatus({ commodityName, latest, hasKey, databento, now }: PriceStatusInput): PriceStatus {
  const cadenceSeconds = databento?.cadenceSeconds || DAY_SECONDS;
  if (!latest) {
    return {
      origin: "none",
      badge: "NO DATA",
      description: `${commodityName} futures · no prices loaded`,
      snapshotNote: hasKey ? "Use Load prices under Data sources to fetch daily bars." : "Add a Databento key under Data sources to load daily bars.",
      freshness: classifyFreshness({ cadenceSeconds, sourceState: databento?.state, hasData: false, now }),
      statusBar: "NO MARKET DATA",
    };
  }
  if (latest.sourceId !== "databento") {
    return {
      origin: "demo",
      badge: "SIMULATED",
      description: `${commodityName} · synthetic demonstration series`,
      snapshotNote: "Latest sample close. This is not a market quote.",
      freshness: { status: "stale", label: `STALE DEMO FIXTURE · ${formatAge(latest.fetchedAt, now)}` },
      statusBar: "STALE DEMO DATA",
    };
  }
  // Unchanged bars are not stored again, so a refresh that finds no new bar (weekends, holidays)
  // only shows up as the source's last successful refresh.
  const freshness = classifyFreshness({ lastConfirmedAt: databento?.lastOk ?? latest.fetchedAt, cadenceSeconds, sourceState: databento?.state, hasData: true, now });
  return {
    origin: "live",
    badge: "CBOT",
    description: `${commodityName} futures · continuous front month`,
    snapshotNote: `Latest available ${commodityName.toLowerCase()} futures daily bar from Databento.`,
    freshness,
    statusBar: freshness.status === "ok" ? "MARKET DATA CURRENT" : freshness.status === "error" ? "PRICE SOURCE ERROR" : "STALE MARKET DATA",
  };
}
