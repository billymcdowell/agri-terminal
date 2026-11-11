import cropRegions from "../../config/crop-regions.json";

export type CropRegion = { id: string; fips: string; name: string; latitude: number; longitude: number };
export const REGIONS: CropRegion[] = cropRegions.regions;
export const COMMODITIES = Object.keys(cropRegions.commodities);
export const CROP_NAMES: Record<string, string> = { ZC: "Corn", ZS: "Soybeans", ZW: "Wheat" };

/** Resolves a state id ("ia") or name ("Iowa"), case-insensitively. */
export function findRegion(query: string | undefined): CropRegion | undefined {
  const needle = query?.trim().toLowerCase();
  return REGIONS.find((region) => region.id === needle || region.name.toLowerCase() === needle);
}
