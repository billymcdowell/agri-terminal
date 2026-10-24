import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceChart } from "./price-chart";

describe("price chart panel", () => {
  it("renders the accessible chart container for supplied OHLC bars", () => {
    const html = renderToStaticMarkup(<PriceChart bars={[{
      seriesId: "price.ZC.close", period: "2026-10-23", releasedAt: "2026-10-23T20:00:00Z",
      open: 4.5, high: 4.6, low: 4.4, close: 4.55, unit: "USD/bushel", sourceId: "fixture", fetchedAt: "2026-10-23T20:00:00Z", revision: 0,
    }]} />);
    expect(html).toContain('aria-label="Futures daily price chart"');
    expect(html).toContain("price-chart-canvas");
  });
});
