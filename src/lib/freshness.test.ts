import { describe, expect, it } from "vitest";
import { classifyFreshness, formatAge } from "./freshness";

const now = Date.parse("2026-10-24T12:00:00Z");
const weekly = 604_800;

describe("freshness classification", () => {
  it("formats ages in minutes, hours and days", () => {
    expect(formatAge("2026-10-24T11:30:00Z", now)).toBe("30m old");
    expect(formatAge("2026-10-24T05:00:00Z", now)).toBe("7h old");
    expect(formatAge("2026-10-21T08:00:00Z", now)).toBe("3d 4h old");
  });
  it("is ok within one and a half cadences", () => {
    expect(classifyFreshness({ lastConfirmedAt: "2026-10-17T12:00:00Z", cadenceSeconds: weekly, hasData: true, now }).status).toBe("ok");
  });
  it("is stale beyond one and a half cadences, with the age", () => {
    const result = classifyFreshness({ lastConfirmedAt: "2026-10-10T12:00:00Z", cadenceSeconds: weekly, hasData: true, now });
    expect(result).toEqual({ status: "stale", label: "STALE · 14d 0h old" });
  });
  it("shows cached data with an error label when the source is failing", () => {
    const result = classifyFreshness({ lastConfirmedAt: "2026-10-23T12:00:00Z", cadenceSeconds: weekly, sourceState: "error", hasData: true, now });
    expect(result.status).toBe("error");
    expect(result.label).toContain("CACHED OBSERVATIONS");
  });
  it("distinguishes waiting from failing when nothing is cached", () => {
    expect(classifyFreshness({ cadenceSeconds: weekly, hasData: false, now }).status).toBe("empty");
    expect(classifyFreshness({ cadenceSeconds: weekly, sourceState: "error", hasData: false, now }).status).toBe("error");
  });
  it("treats data with no confirmation time as stale rather than fresh", () => {
    expect(classifyFreshness({ cadenceSeconds: weekly, hasData: true, now }).status).toBe("stale");
  });
});
