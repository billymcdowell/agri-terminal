import waterways from "../../config/waterways.json";

export type RiverGauge = { id: string; name: string; riverId: string; riverName: string };

/** Gauges from the bundled waterways file. A file in the app data directory can retune thresholds, but these names drive panel settings. */
export const GAUGES: RiverGauge[] = waterways.rivers.flatMap((river) =>
  river.gauges.map((gauge) => ({ id: gauge.id, name: gauge.name, riverId: river.id, riverName: river.name })),
);

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolves a gauge id ("stlouis"), name ("St. Louis" or "MEMPHIS"), or river id ("MISS", its first gauge). */
export function findGauge(query: string | undefined): RiverGauge | undefined {
  const needle = normalize(query ?? "");
  if (!needle) return undefined;
  return GAUGES.find((gauge) => gauge.id === needle)
    ?? GAUGES.find((gauge) => normalize(gauge.name).startsWith(needle))
    ?? GAUGES.find((gauge) => gauge.riverId === needle || normalize(gauge.riverName).startsWith(needle));
}
