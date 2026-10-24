import { describe, expect, it } from "vitest";
import type { WeatherForecast } from "@/lib/ipc";
import { nextForecastsBySource } from "./weather";

const forecast = (regionId: string, provider: string, validAt: string): WeatherForecast => ({
  regionId, regionName: regionId, latitude: 0, longitude: 0, provider, validAt,
  temperatureC: 10, precipitationMm: 0, precipitationProbability: null, windKph: 5, relativeHumidity: null, summary: "",
});

describe("nextForecastsBySource", () => {
  it("keeps the first future period for each region and provider", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const result = nextForecastsBySource([
      forecast("ia", "NWS", "2026-10-24T10:00:00Z"),
      forecast("ia", "NWS", "2026-10-24T14:00:00Z"),
      forecast("ia", "NWS", "2026-10-24T13:00:00Z"),
      forecast("ia", "Open-Meteo", "2026-10-24T13:00:00Z"),
    ], now);
    expect(result.map((item) => `${item.provider}@${item.validAt}`).sort()).toEqual(["NWS@2026-10-24T13:00:00Z", "Open-Meteo@2026-10-24T13:00:00Z"]);
  });
});
