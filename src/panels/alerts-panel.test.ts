import { describe, expect, it } from "vitest";
import { alertNotification, describeAlert, parseThreshold, riverAlertStatus } from "./alerts-panel";

describe("alerts panel helpers", () => {
  it("accepts only positive prices", () => {
    expect(parseThreshold("4.55")).toBe(4.55);
    for (const bad of ["", "abc", "0", "-1", "Infinity"]) expect(parseThreshold(bad)).toBeNull();
  });
  it("shows stored bushel prices in metric tonnes when asked", () => {
    expect(describeAlert({ symbol: "ZC", direction: "above", threshold: 4.5 }, "metric")).toBe("ZC at or above 177.16 USD/tonne");
  });
  it("describes an alert in plain words", () => {
    expect(describeAlert({ symbol: "ZW", direction: "below", threshold: 5.5 })).toBe("ZW at or below 5.50 USD/bu");
  });
  it("labels river alerts by their state", () => {
    expect(riverAlertStatus({ rule: "below_restriction", enabled: true, state: 0 })).toBe("ARMED");
    expect(riverAlertStatus({ rule: "below_restriction", enabled: true, state: 1 })).toBe("TRIGGERED");
    expect(riverAlertStatus({ rule: "band_up", enabled: true, state: 2 })).toBe("AT HIGH");
    expect(riverAlertStatus({ rule: "band_up", enabled: false, state: 2 })).toBe("PAUSED");
  });
  it("words a fired alert's notification in the display unit", () => {
    const fired = { id: "a", symbol: "ZC", direction: "above" as const, threshold: 4.5, close: 4.55, date: "2026-10-23" };
    expect(alertNotification(fired)).toEqual({ title: "ZC at or above 4.50 USD/bu", body: "Latest close 4.55 USD/bu on 2026-10-23." });
    expect(alertNotification(fired, "metric")).toEqual({ title: "ZC at or above 177.16 USD/tonne", body: "Latest close 179.12 USD/tonne on 2026-10-23." });
  });
});
