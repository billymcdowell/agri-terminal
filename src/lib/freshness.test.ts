import { describe, expect, it } from "vitest";
import { classifyFreshness, formatAge, needsAttention } from "./freshness";

const now = Date.parse("2026-10-24T12:00:00Z");
const weekly = 604_800;

describe("freshness classification", () => {
  it("formats ages in minutes, hours and days", () => {
    expect(formatAge("2026-10-24T11:30:00Z", now)).toBe("30m ago");
    expect(formatAge("2026-10-24T05:00:00Z", now)).toBe("7h ago");
    expect(formatAge("2026-10-21T08:00:00Z", now)).toBe("3d 4h ago");
  });
  it("is ok within one and a half cadences", () => {
    expect(classifyFreshness({ lastConfirmedAt: "2026-10-17T12:00:00Z", cadenceSeconds: weekly, hasData: true, now }).status).toBe("ok");
  });
  it("is stale beyond one and a half cadences, with the age", () => {
    const result = classifyFreshness({ lastConfirmedAt: "2026-10-10T12:00:00Z", cadenceSeconds: weekly, hasData: true, now });
    expect(result).toEqual({ status: "stale", label: "Out of date · updated 14d 0h ago" });
  });
  it("shows cached data with an error label when the source is failing", () => {
    const result = classifyFreshness({ lastConfirmedAt: "2026-10-23T12:00:00Z", cadenceSeconds: weekly, sourceState: "error", hasData: true, now });
    expect(result.status).toBe("error");
    expect(result.label).toBe("Update failed · showing data from 1d 0h ago");
  });
  it("distinguishes waiting from failing when nothing is cached", () => {
    expect(classifyFreshness({ cadenceSeconds: weekly, hasData: false, now }).status).toBe("empty");
    expect(classifyFreshness({ cadenceSeconds: weekly, sourceState: "error", hasData: false, now }).status).toBe("error");
  });
  it("treats data with no confirmation time as stale rather than fresh", () => {
    expect(classifyFreshness({ cadenceSeconds: weekly, hasData: true, now }).status).toBe("stale");
  });
  it("flags a switched-on source that is failing or past due, and nothing else", () => {
    const source = { enabled: true, state: "ok", lastOk: "2026-10-23T12:00:00Z", cadenceSeconds: weekly };
    expect(needsAttention(source, now)).toBe(false);
    expect(needsAttention({ ...source, state: "error" }, now)).toBe(true);
    expect(needsAttention({ ...source, lastOk: "2026-10-10T12:00:00Z" }, now)).toBe(true);
    expect(needsAttention({ ...source, lastOk: "2026-10-10T12:00:00Z", enabled: false }, now)).toBe(false);
    expect(needsAttention({ ...source, lastOk: null }, now)).toBe(false);
  });
});
