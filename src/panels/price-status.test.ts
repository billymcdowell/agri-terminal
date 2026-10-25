import { describe, expect, it } from "vitest";
import { priceStatus } from "./price-status";

const now = Date.parse("2026-10-25T12:00:00Z");
const databento = { lastOk: "2026-10-25T06:00:00Z", state: "ok", cadenceSeconds: 86_400 };

describe("priceStatus", () => {
  it("does not describe a commodity with no prices as market data", () => {
    const status = priceStatus({ commodityName: "Soybeans", hasKey: false, now });
    expect(status.origin).toBe("none");
    expect(status.badge).toBe("NO DATA");
    expect(status.description).toBe("Soybeans futures · no prices loaded");
    expect(status.snapshotNote).toContain("Add a Databento key");
    expect(status.statusBar).toBe("NO MARKET DATA");
  });
  it("points to Load prices once a key is saved", () => {
    expect(priceStatus({ commodityName: "Wheat", hasKey: true, now }).snapshotNote).toContain("Load prices");
  });
  it("labels the fixture as simulated and stale", () => {
    const status = priceStatus({ commodityName: "Corn", latest: { sourceId: "fixture-corn", fetchedAt: "2026-10-23T19:00:00Z" }, hasKey: false, now });
    expect(status.badge).toBe("SIMULATED");
    expect(status.freshness.status).toBe("stale");
    expect(status.statusBar).toBe("STALE DEMO DATA");
  });
  it("names the commodity being shown", () => {
    const status = priceStatus({ commodityName: "Soybeans", latest: { sourceId: "databento", fetchedAt: "2026-10-24T22:00:00Z" }, hasKey: true, databento, now });
    expect(status.snapshotNote).toBe("Latest available soybeans futures daily bar from Databento.");
  });
  it("stays current over a weekend while the daily refresh keeps succeeding", () => {
    // Sunday: Friday's bar was first fetched two days ago, but this morning's refresh succeeded.
    const status = priceStatus({ commodityName: "Corn", latest: { sourceId: "databento", fetchedAt: "2026-10-23T22:00:00Z" }, hasKey: true, databento, now });
    expect(status.freshness.status).toBe("ok");
    expect(status.statusBar).toBe("MARKET DATA CURRENT");
  });
  it("is stale when refreshes stop succeeding, and shows source errors", () => {
    const latest = { sourceId: "databento", fetchedAt: "2026-10-20T22:00:00Z" };
    expect(priceStatus({ commodityName: "Corn", latest, hasKey: true, databento: { ...databento, lastOk: "2026-10-20T22:00:00Z" }, now }).statusBar).toBe("STALE MARKET DATA");
    expect(priceStatus({ commodityName: "Corn", latest, hasKey: true, databento: { ...databento, state: "error" }, now }).statusBar).toBe("PRICE SOURCE ERROR");
  });
});
