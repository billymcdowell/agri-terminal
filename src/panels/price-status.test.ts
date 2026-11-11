import { describe, expect, it } from "vitest";
import { priceStatus } from "./price-status";

const now = Date.parse("2026-10-25T12:00:00Z");
const priceSource = { lastOk: "2026-10-25T06:00:00Z", state: "ok", cadenceSeconds: 86_400 };

describe("priceStatus", () => {
  it("does not describe a commodity with no prices as market data", () => {
    expect(priceStatus({ now })).toEqual({ origin: "none" });
  });
  it("labels the fixture as demonstration data, even with a price source configured", () => {
    expect(priceStatus({ latest: { sourceId: "fixture-corn", fetchedAt: "2026-10-23T19:00:00Z" }, priceSource, now })).toEqual({ origin: "demo" });
  });
  it("names the provider of market data", () => {
    const status = priceStatus({ latest: { sourceId: "massive", fetchedAt: "2026-10-24T22:00:00Z" }, priceSource, now });
    expect(status).toMatchObject({ origin: "live", provider: "Massive" });
  });
  it("still treats bars stored by the retired Databento source as market data", () => {
    const status = priceStatus({ latest: { sourceId: "databento", fetchedAt: "2026-10-24T22:00:00Z" }, priceSource, now });
    expect(status).toMatchObject({ origin: "live", provider: "Databento" });
  });
  it("stays current over a weekend while the daily refresh keeps succeeding", () => {
    // Sunday: Friday's bar was first fetched two days ago, but this morning's refresh succeeded.
    const status = priceStatus({ latest: { sourceId: "massive", fetchedAt: "2026-10-23T22:00:00Z" }, priceSource, now });
    expect(status).toMatchObject({ freshness: { status: "ok" } });
  });
  it("is stale when refreshes stop succeeding, and shows source errors", () => {
    const latest = { sourceId: "massive", fetchedAt: "2026-10-20T22:00:00Z" };
    expect(priceStatus({ latest, priceSource: { ...priceSource, lastOk: "2026-10-20T22:00:00Z" }, now })).toMatchObject({ freshness: { status: "stale" } });
    expect(priceStatus({ latest, priceSource: { ...priceSource, state: "error" }, now })).toMatchObject({ freshness: { status: "error" } });
  });
});
