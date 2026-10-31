import { describe, expect, it } from "vitest";
import { findGauge, GAUGES } from "./waterways";

describe("river gauges", () => {
  it("lists the bundled Mississippi gauges", () => {
    expect(GAUGES.map((gauge) => gauge.id)).toEqual(["stlouis", "memphis"]);
  });
  it.each([
    ["stlouis", "stlouis"],
    ["ST LOUIS", "stlouis"],
    ["St. Louis, MO", "stlouis"],
    ["memphis", "memphis"],
    ["MISS", "stlouis"],
    ["mississippi", "stlouis"],
  ])("finds %s", (query, id) => expect(findGauge(query)?.id).toBe(id));
  it("does not guess at unknown names", () => {
    expect(findGauge("Rosario")).toBeUndefined();
    expect(findGauge("")).toBeUndefined();
  });
});
