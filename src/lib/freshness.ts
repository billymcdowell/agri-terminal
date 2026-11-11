export type FreshnessStatus = "ok" | "stale" | "error" | "empty";
export type Freshness = { status: FreshnessStatus; label: string };

export function formatAge(timestamp: string | number | Date, now: number) {
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ${elapsedHours % 24}h ago`;
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

/**
 * One plain line on how current a section's data is. Status always carries text as well as a color
 * token, so it never relies on color alone. Why a source failed is in Settings › Data sources, which
 * the top bar's ⚠ opens, so sections do not repeat error messages.
 */
export function classifyFreshness({ lastConfirmedAt, cadenceSeconds, sourceState, hasData, now }: FreshnessInput): Freshness {
  if (!hasData) {
    return { status: sourceState === "error" ? "error" : "empty", label: sourceState === "error" ? "Could not load yet" : "No data yet" };
  }
  const age = lastConfirmedAt ? formatAge(lastConfirmedAt, now) : "at an unknown time";
  if (sourceState === "error") return { status: "error", label: `Update failed · showing data from ${age}` };
  const ageMs = lastConfirmedAt ? now - new Date(lastConfirmedAt).getTime() : Number.POSITIVE_INFINITY;
  if (ageMs > STALE_AFTER_CADENCES * cadenceSeconds * 1000) return { status: "stale", label: `Out of date · updated ${age}` };
  return { status: "ok", label: `Updated ${age}` };
}

/** Whether a source belongs under the top bar's ⚠: switched on, and failing or past due. */
export function needsAttention(source: { enabled: boolean; state: string; lastOk: string | null; cadenceSeconds: number }, now: number) {
  if (!source.enabled) return false;
  if (source.state === "error") return true;
  if (!source.lastOk || !source.cadenceSeconds) return false;
  return now - new Date(source.lastOk).getTime() > STALE_AFTER_CADENCES * source.cadenceSeconds * 1000;
}
