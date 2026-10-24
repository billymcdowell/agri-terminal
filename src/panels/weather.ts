import type { WeatherForecast } from "@/lib/ipc";

/** The earliest forecast period still ahead of `now`, per region and provider. */
export function nextForecastsBySource(forecasts: WeatherForecast[], now: number) {
  const next = new Map<string, WeatherForecast>();
  for (const forecast of forecasts) {
    if (new Date(forecast.validAt).getTime() < now) continue;
    const key = `${forecast.regionId}:${forecast.provider}`;
    const previous = next.get(key);
    if (!previous || forecast.validAt < previous.validAt) next.set(key, forecast);
  }
  return [...next.values()];
}
