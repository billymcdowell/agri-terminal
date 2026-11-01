import { classifyFreshness, type Freshness } from "@/lib/freshness";
import type { PriceBar, SourceStatus } from "@/lib/ipc";

const DAY_SECONDS = 86_400;

/** Sources whose bars are exchange market data. Databento was the price source before Massive, and bars it stored are still real. */
const MARKET_PROVIDERS: Record<string, string> = { massive: "Massive", databento: "Databento" };

/** Where the chart's prices come from: market bars with their provider and freshness, the corn demonstration fixture, or nothing yet. */
export type PriceStatus =
  | { origin: "none" }
  | { origin: "demo" }
  | { origin: "live"; provider: string; freshness: Freshness };

type PriceStatusInput = {
  latest?: Pick<PriceBar, "sourceId" | "fetchedAt">;
  priceSource?: Pick<SourceStatus, "lastOk" | "state" | "cadenceSeconds">;
  now: number;
};

/** Only bars from a market data provider are described as market data. */
export function priceStatus({ latest, priceSource, now }: PriceStatusInput): PriceStatus {
  if (!latest) return { origin: "none" };
  const provider = MARKET_PROVIDERS[latest.sourceId];
  if (!provider) return { origin: "demo" };
  // Unchanged bars are not stored again, so a refresh that finds no new bar (weekends, holidays)
  // only shows up as the source's last successful refresh.
  const freshness = classifyFreshness({
    lastConfirmedAt: priceSource?.lastOk ?? latest.fetchedAt,
    cadenceSeconds: priceSource?.cadenceSeconds || DAY_SECONDS,
    sourceState: priceSource?.state,
    hasData: true,
    now,
  });
  return { origin: "live", provider, freshness };
}
