import { describe, expect, it } from "vitest";
import { percentileRank } from "./stats";

describe("percentileRank", () => {
  it("ranks the current value against its own history", () => {
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(100);
    expect(percentileRank([1, 2, 3, 4], 2)).toBe(50);
    expect(percentileRank([-5, 10, 20, 30], -5)).toBe(25);
  });
  it("returns undefined without history", () => expect(percentileRank([], 1)).toBeUndefined());
});
