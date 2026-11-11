import type { ConstraintScore, RiverBand, RiverStatus } from "@/lib/ipc";

/**
 * Wording for the river panels. River events are possible pressures on freight and basis, never
 * proven causes of a price move, so nothing here asserts cause; a test checks this.
 */
export const RIVER_TEXT = {
  title: (gauge: string) => `River at ${gauge}`,
  timelineTitle: (gauge: string) => `River and freight over time at ${gauge}`,
  scoreHeading: "Constraint score",
  stageHeading: "River stage",
  forecastHeading: "Forecast, next 7 days",
  freightHeading: "Barge freight",
  trafficHeading: "Grain through locks",
  partial: "Partial",
  partialNote: "Some inputs are missing or out of date, so the score uses the others, re-weighted.",
  trafficNote: "Shown for context. Lock tonnage follows the harvest calendar more than the river, so it is not part of the score.",
  noScore: "No river data yet. The stage, forecast and barge sources fill in after their first refresh.",
  noForecast: "No current forecast.",
  noFreight: "No current barge rate.",
  noTraffic: "No current lock tonnage.",
  timelineNoData: "No river stage is stored yet.",
  pressureHeading: "Freight pressure, next 14 days",
  noPressure: "Needs a current forecast reaching two weeks ahead and enough past low-water weeks to measure how freight reacted.",
} as const;

export const BAND_LABELS: Record<RiverBand, string> = { NORMAL: "Normal", ELEVATED: "Elevated", HIGH: "High" };

export function formatFeet(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)} ft`;
}

export function formatPercentChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "■";
  return `${arrow} ${Math.abs(value).toFixed(1)}%`;
}

export function formatTons(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} short tons`;
}

/** Where the stage sits against the gauge's thresholds, in words. */
export function stagePosition(status: Pick<RiverStatus, "stage" | "thresholds">) {
  const stage = status.stage?.value;
  if (stage === undefined) return "No current reading.";
  const { normal, restriction, critical } = status.thresholds;
  if (stage <= critical) return `At or below the critical level (${formatFeet(critical)}).`;
  if (stage <= restriction) return `${formatFeet(stage - critical)} above the critical level, below the restriction level (${formatFeet(restriction)}).`;
  if (stage < normal) return `${formatFeet(stage - restriction)} above the restriction level (${formatFeet(restriction)}), below normal (${formatFeet(normal)}).`;
  return `At or above normal (${formatFeet(normal)}).`;
}

/** "+43.8% of tariff per ft over 2 weeks · fit R² 0.06 from 308 two-week pairs". */
export function describeSensitivity(sensitivity: { beta: number; rSquared: number; pairs: number; horizonWeeks: number }) {
  const sign = sensitivity.beta >= 0 ? "+" : "−";
  return `${sign}${Math.abs(sensitivity.beta).toFixed(1)}% of tariff per ft deeper below the restriction level over ${sensitivity.horizonWeeks} weeks · fit R² ${sensitivity.rSquared.toFixed(2)} from ${sensitivity.pairs} pairs of weeks`;
}

/** The weighted points each component adds, for the breakdown line. */
export function componentBreakdown(score: ConstraintScore) {
  const part = (label: string, component: ConstraintScore["depth"]) => (!component ? `${label} missing` : component.weight === 0 ? `${label} not scored` : `${label} ${component.points.toFixed(1)}`);
  return [part("Depth", score.depth), part("Forecast", score.forecast), part("Traffic", score.traffic)].join(" · ");
}
