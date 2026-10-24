export type FreshnessStatus = "ok" | "stale" | "error" | "empty";
export type Freshness = { status: FreshnessStatus; label: string };

export function formatAge(timestamp: string | number | Date, now: number) {
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m old`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h old`;
  return `${Math.floor(elapsedHours / 24)}d ${elapsedHours % 24}h old`;
}

/** A series is stale once it is more than one and a half publishing cadences old. */
export const STALE_AFTER_CADENCES = 1.5;

type FreshnessInput = {
  /** When the data was last confirmed current: the source's last successful refresh, else the row's fetch time. */
  lastConfirmedAt?: string | null;
  cadenceSeconds: number;
  sourceState?: string;
  hasData: boolean;
  now: number;
};

/** Status always carries text as well as a color token, so it never relies on color alone. */
export function classifyFreshness({ lastConfirmedAt, cadenceSeconds, sourceState, hasData, now }: FreshnessInput): Freshness {
  if (!hasData) {
    return { status: sourceState === "error" ? "error" : "empty", label: sourceState === "error" ? "ERROR · no cached data" : "WAITING · no data yet" };
  }
  const age = lastConfirmedAt ? formatAge(lastConfirmedAt, now) : "age unknown";
  if (sourceState === "error") return { status: "error", label: `ERROR · CACHED OBSERVATIONS · ${age}` };
  const ageMs = lastConfirmedAt ? now - new Date(lastConfirmedAt).getTime() : Number.POSITIVE_INFINITY;
  if (ageMs > STALE_AFTER_CADENCES * cadenceSeconds * 1000) return { status: "stale", label: `STALE · ${age}` };
  return { status: "ok", label: `OK · ${age}` };
}
