/** All generated wording for the move explainer. Reports possible drivers, never proven causes. */
export const EXPLAINER_TEXT = {
  intro: "Daily moves larger than two standard deviations of the previous 20 days. Drivers are possible matches by timing, relevance and direction, not established causes.",
  none: "No clear driver found",
  noMoves: "No moves beyond this threshold in the cached prices.",
  dismiss: "Dismiss",
  restore: (count: number) => `Show ${count} dismissed`,
  notePlaceholder: "Add a note",
  reasonsHeading: "Why this is a possible driver",
} as const;
