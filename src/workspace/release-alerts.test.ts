import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/ipc";
import { dueAlerts } from "./release-alerts";

const event = (id: string, scheduledAt: string): CalendarEvent => ({ id, kind: "COT", scheduledAt, commodity: null, title: id });
const now = Date.parse("2026-10-29T20:00:00Z");

describe("dueAlerts", () => {
  it("includes releases within 24 hours that were not sent", () => {
    const events = [event("soon", "2026-10-30T19:30:00Z"), event("later", "2026-11-05T19:30:00Z"), event("past", "2026-10-29T10:00:00Z"), event("sent", "2026-10-30T10:00:00Z")];
    expect(dueAlerts(events, now, (id) => id === "sent").map((item) => item.id)).toEqual(["soon"]);
  });
});
