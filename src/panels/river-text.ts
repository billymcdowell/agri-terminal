import type { ConstraintScore, RiverBand, RiverStatus } from "@/lib/ipc";

/**
 * Wording for the river panels. River events are possible pressures on freight and basis, never
 * proven causes of a price move, so nothing here asserts cause; a test checks this.
 */
export const RIVER_TEXT = {
  eyebrow: "RIVER PANEL",
  timelineEyebrow: "COMBINED VIEW",
  title: (gauge: string) => `River status · ${gauge}`,
  timelineTitle: (gauge: string, commodity: string) => `River timeline · ${gauge} · ${commodity}`,
  scoreHeading: "Constraint score",
  stageHeading: "River stage",
  forecastHeading: "Forecast, next 7 days",
  freightHeading: "Barge freight",
  trafficHeading: "Grain through locks",
  partial: "PARTIAL",
  partialNote: "Some inputs are missing or out of date, so the score uses the others, re-weighted.",
  provisional: "Thresholds are provisional starting values until they are calibrated against past low-water years.",
  noScore: "No river data yet. The stage, forecast and barge sources fill in after their first refresh.",
  noForecast: "No current forecast.",
  noFreight: "No current barge rate.",
  noTraffic: "No current lock tonnage.",
  trader: "Low water tends to show up first in barge freight and in the gap between Gulf and interior basis, more than in futures. Treat a high score as a possible pressure on spreads, not a price call.",
  farmer: "When the river runs low, barges carry less and freight costs more, so elevators that ship by river often bid less against futures (local basis weakens). A high score is a reason to check your local bids, not a price forecast.",
  timelineIntro: "Stage, forecast, barge freight and the constraint score, each as it was known at that day's close.",
  timelineNoData: "No river stage is stored yet.",
  basisNote: "Gulf versus interior basis needs a public interior basis source, which is not connected yet.",
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

/** The weighted points each component adds, for the breakdown line. */
export function componentBreakdown(score: ConstraintScore) {
  const part = (label: string, component: ConstraintScore["depth"]) => (component ? `${label} ${component.points.toFixed(1)}` : `${label} missing`);
  return [part("Depth", score.depth), part("Forecast", score.forecast), part("Traffic", score.traffic)].join(" · ");
}
