import { describe, expect, it } from "vitest";
import { fromDisplayPrice, toDisplayPrice } from "./units";

describe("price units", () => {
  it("leaves bushel prices untouched", () => {
    expect(toDisplayPrice(4.5, "ZC", "bushel")).toBe(4.5);
  });
  it("converts to USD per metric tonne with the commodity's bushel weight", () => {
    expect(toDisplayPrice(4.5, "ZC", "metric")).toBeCloseTo(177.156, 3);
    expect(toDisplayPrice(10, "ZS", "metric")).toBeCloseTo(367.437, 3);
    expect(toDisplayPrice(5.5, "ZW", "metric")).toBeCloseTo(202.09, 2);
  });
  it("round trips through the display unit", () => {
    for (const commodity of ["ZC", "ZS", "ZW"]) expect(fromDisplayPrice(toDisplayPrice(4.37, commodity, "metric"), commodity, "metric")).toBeCloseTo(4.37, 10);
  });
  it("leaves unknown commodities unconverted rather than guessing a weight", () => {
    expect(toDisplayPrice(2, "XX", "metric")).toBe(2);
  });
});
