import { usePersistedValue } from "@/state/use-persisted-list";

/** Prices are stored in USD per bushel, as CME quotes them; this is a display preference only. */
export type UnitSystem = "bushel" | "metric";

/** Bushels per metric tonne (USDA conversion factors): corn 39.3680, soybeans and wheat 36.7437. */
const BUSHELS_PER_TONNE: Record<string, number> = { ZC: 39.368, ZS: 36.7437, ZW: 36.7437 };

export const UNIT_LABELS: Record<UnitSystem, string> = { bushel: "USD/bu", metric: "USD/tonne" };

const factor = (commodity: string, units: UnitSystem) => (units === "metric" ? (BUSHELS_PER_TONNE[commodity] ?? 1) : 1);

export function toDisplayPrice(usdPerBushel: number, commodity: string, units: UnitSystem): number {
  return usdPerBushel * factor(commodity, units);
}

export function fromDisplayPrice(displayed: number, commodity: string, units: UnitSystem): number {
  return displayed / factor(commodity, units);
}

export function useUnits(): UnitSystem {
  return usePersistedValue<UnitSystem>("units", "bushel")[0];
}
