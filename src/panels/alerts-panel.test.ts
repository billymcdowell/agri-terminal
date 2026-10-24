import { describe, expect, it } from "vitest";
import { describeAlert, parseThreshold } from "./alerts-panel";

describe("alerts panel helpers", () => {
  it("accepts only positive prices", () => {
    expect(parseThreshold("4.55")).toBe(4.55);
    for (const bad of ["", "abc", "0", "-1", "Infinity"]) expect(parseThreshold(bad)).toBeNull();
  });
  it("describes an alert in plain words", () => {
    expect(describeAlert({ symbol: "ZW", direction: "below", threshold: 5.5 })).toBe("ZW at or below 5.50 USD/bu");
  });
});
