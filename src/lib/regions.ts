import cropRegions from "../../config/crop-regions.json";

export type CropRegion = { id: string; fips: string; name: string; latitude: number; longitude: number };
export const REGIONS: CropRegion[] = cropRegions.regions;
export const COMMODITIES = Object.keys(cropRegions.commodities);
export const CROP_NAMES: Record<string, string> = { ZC: "Corn", ZS: "Soybeans", ZW: "Wheat" };
const CROP_ADJECTIVES: Record<string, string> = { ZC: "Corn", ZS: "Soybean", ZW: "Wheat" };

/** "Corn", "Soybeans" or "Wheat" for a futures symbol; the symbol itself for anything else. */
export function cropName(symbol: string) { return CROP_NAMES[symbol] ?? symbol; }

/** The crop as a modifier, such as "Soybean" in "Soybean balance sheet". */
export function cropAdjective(symbol: string) { return CROP_ADJECTIVES[symbol] ?? symbol; }

/** "ZC, ZS, ZW" as "Corn, soybeans, wheat". */
export function cropList(symbols: string) {
  const names = symbols.split(/[\s,]+/).filter(Boolean).map((symbol) => cropName(symbol).toLowerCase());
  return names.length ? names.join(", ").replace(/^./, (first) => first.toUpperCase()) : symbols;
}

/** Resolves a state id ("ia") or name ("Iowa"), case-insensitively. */
export function findRegion(query: string | undefined): CropRegion | undefined {
  const needle = query?.trim().toLowerCase();
  return REGIONS.find((region) => region.id === needle || region.name.toLowerCase() === needle);
}
