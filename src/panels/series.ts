export type MetricRow = { label: string; seriesId: string };

/** Local series ids written by the Rust connectors; keep in step with src-tauri/src/sources/fundamentals.rs. */
export function cotRows(commodity: string): MetricRow[] {
  return [
    { label: "Managed money net", seriesId: `cot.${commodity}.managed_money_net` },
    { label: "Producer / merchant net", seriesId: `cot.${commodity}.commercial_net` },
    { label: "Swap dealer net", seriesId: `cot.${commodity}.swap_net` },
  ];
}

export function cropConditionRows(commodity: string): MetricRow[] {
  const symbol = commodity.toLowerCase();
  return [
    { label: "Good / excellent", seriesId: `nass.${symbol}.condition.good_excellent` },
    { label: "Fair", seriesId: `nass.${symbol}.condition.fair` },
    { label: "Poor / very poor", seriesId: `nass.${symbol}.condition.poor_very_poor` },
    { label: "Planted", seriesId: `nass.${symbol}.progress.planted` },
    { label: "Harvested", seriesId: `nass.${symbol}.progress.harvested` },
  ];
}

export function balanceSheetRows(commodity: string): MetricRow[] {
  const symbol = commodity.toLowerCase();
  return [
    ["Beginning stocks", "beginning_stocks"],
    ["Production", "production"],
    ["Imports", "imports"],
    ["Domestic consumption", "domestic_consumption"],
    ["Exports", "exports"],
    ["Ending stocks", "ending_stocks"],
  ].map(([label, name]) => ({ label, seriesId: `fas.${symbol}.${name}` }));
}

export function droughtRows(stateId: string): MetricRow[] {
  return [
    ["D0 · Abnormally dry", "D0"],
    ["D1 · Moderate", "D1"],
    ["D2 · Severe", "D2"],
    ["D3 · Extreme", "D3"],
    ["D4 · Exceptional", "D4"],
  ].map(([label, level]) => ({ label, seriesId: `drought.${stateId.toLowerCase()}.${level}` }));
}
