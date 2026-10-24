import { describe, expect, it } from "vitest";
import { coerceValue, LINK_GROUP_PROPERTY } from "./config-schema";

describe("coerceValue", () => {
  it("accepts only listed enum values", () => {
    expect(coerceValue(LINK_GROUP_PROPERTY, "B")).toBe("B");
    expect(coerceValue(LINK_GROUP_PROPERTY, "Z")).toBeNull();
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
