/** Share of historical values at or below `value`, as a whole percentage. */
export function percentileRank(values: number[], value: number): number | undefined {
  if (!values.length) return undefined;
  return Math.round((values.filter((item) => item <= value).length / values.length) * 100);
}
