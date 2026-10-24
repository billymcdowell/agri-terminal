/** All generated wording for the move explainer. Reports possible drivers, never proven causes. */
export const EXPLAINER_TEXT = {
  eyebrow: "MOVE EXPLAINER",
  heading: (commodity: string) => `${commodity} flagged moves`,
  intro: "Daily moves larger than the chosen number of standard deviations of the previous 20 days. Drivers are possible matches by timing, relevance and direction, not established causes.",
  none: "No clear driver found",
  noMoves: "No moves beyond this threshold in the cached prices.",
  demo: "These prices are a synthetic demonstration series, so flagged moves are not market events.",
  pin: "Pin",
  unpin: "Unpin",
  dismiss: "Dismiss",
  restore: (count: number) => `Show ${count} dismissed`,
  notePlaceholder: "Add a note",
  reasonsHeading: "Why this is a possible driver",
} as const;
