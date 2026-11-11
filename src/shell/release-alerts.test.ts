import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/ipc";
import { describeLead, dueAlerts } from "./release-alerts";

const event = (id: string, scheduledAt: string): CalendarEvent => ({ id, kind: "COT", scheduledAt, commodity: null, title: id });
const now = Date.parse("2026-10-29T20:00:00Z");
const events = [event("soon", "2026-10-30T19:30:00Z"), event("later", "2026-11-05T19:30:00Z"), event("past", "2026-10-29T10:00:00Z"), event("sent", "2026-10-30T10:00:00Z"), event("tonight", "2026-10-29T21:30:00Z")];

describe("dueAlerts", () => {
  it("includes releases within 24 hours that were not sent", () => {
    expect(dueAlerts(events, now, (id) => id === "sent").map((item) => item.id)).toEqual(["soon", "tonight"]);
  });
  it("honours a shorter lead time", () => {
    expect(dueAlerts(events, now, () => false, 2).map((item) => item.id)).toEqual(["tonight"]);
  });
  it("a lead time of zero turns alerts off", () => {
    expect(dueAlerts(events, now, () => false, 0)).toEqual([]);
  });
  it("a longer lead time reaches further ahead", () => {
    expect(dueAlerts(events, now, () => false, 48).map((item) => item.id)).toContain("sent");
  });
});

describe("describeLead", () => {
  it("speaks in minutes, then hours", () => {
    expect(describeLead(30_000)).toBe("in 1 minute");
    expect(describeLead(45 * 60_000)).toBe("in 45 minutes");
    expect(describeLead(60 * 60_000)).toBe("in about 1 hour");
    expect(describeLead(5.4 * 3_600_000)).toBe("in about 5 hours");
  });
});
