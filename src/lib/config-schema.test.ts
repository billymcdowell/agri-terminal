import { describe, expect, it } from "vitest";
import { coerceValue, type ConfigProperty } from "./config-schema";

const gauge: ConfigProperty = { type: "string", title: "Gauge", enum: ["", "stl", "mem"], enumLabels: { "": "None" } };

describe("coerceValue", () => {
  it("accepts only listed enum values", () => {
    expect(coerceValue(gauge, "mem")).toBe("mem");
    expect(coerceValue(gauge, "xyz")).toBeNull();
  });
  it("clamps numbers into range and rejects non-numbers", () => {
    const property = { type: "number", title: "SD", minimum: 1, maximum: 4 } as const;
    expect(coerceValue(property, "9")).toBe(4);
    expect(coerceValue(property, "0.2")).toBe(1);
    expect(coerceValue(property, "abc")).toBeNull();
  });
  it("passes booleans through", () => {
    expect(coerceValue({ type: "boolean", title: "x" }, true)).toBe(true);
  });
});
