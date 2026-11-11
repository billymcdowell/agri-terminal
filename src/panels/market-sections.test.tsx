// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, MoveExplanation } from "@/lib/ipc";

const ipc = vi.hoisted(() => ({
  explainMoves: vi.fn(),
  listCalendarEvents: vi.fn(),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ipc", () => ipc);

import { useCrop } from "@/shell/crop";
import { orderReports, CalendarPanel } from "./calendar-panel";
import { BigMovesSection, MoveDriversDrawer } from "./move-explainer-panel";
import { timeToDate } from "./price-chart";

const move = (date: string, logReturn: number, drivers: MoveExplanation["drivers"] = []): MoveExplanation => ({
  move: { date, logReturn, zScore: logReturn * 200 } as MoveExplanation["move"],
  label: "",
  drivers,
});
const driver = (title: string, label = "Likely driver"): MoveExplanation["drivers"][number] => ({
  kind: "scheduled_event", title, url: null, source: "USDA", at: "2026-10-28T16:00:00Z", label, score: 1, reasons: ["Released between the closes"],
});

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("Big moves", () => {
  beforeEach(() => {
    useCrop.setState({ crop: "ZC" });
    ipc.explainMoves.mockResolvedValue([
      move("2026-10-28", 0.05, [driver("WASDE"), driver("Export headline", "Possible driver")]),
      ...["2026-10-01", "2026-09-15", "2026-08-12", "2026-07-30", "2026-06-30"].map((date) => move(date, -0.03)),
    ]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("lists the five newest moves with their leading driver, and the rest on request", async () => {
    withClient(<BigMovesSection onSelect={() => undefined} />);
    expect(await screen.findByText(/2026-10-28 · ▲ 5.00%/)).toBeTruthy();
    expect(screen.getByText("likely driver: WASDE")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 6 moves" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("opens a move's drivers, where they can be dismissed and restored but not pinned", async () => {
    const onSelect = vi.fn();
    withClient(<BigMovesSection onSelect={onSelect} />);
    fireEvent.click(await screen.findByText(/2026-10-28 · ▲ 5.00%/));
    expect(onSelect).toHaveBeenCalledWith("2026-10-28");
    cleanup();

    withClient(<MoveDriversDrawer date="2026-10-28" onClose={() => undefined} />);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("WASDE")).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Pin" })).toBeNull();
    fireEvent.click(within(drawer).getAllByRole("button", { name: "Dismiss" })[0]);
    await waitFor(() => expect(within(drawer).queryByText("WASDE")).toBeNull());
    fireEvent.click(within(drawer).getByRole("button", { name: "Show 1 dismissed" }));
    await waitFor(() => expect(within(drawer).getByText("WASDE")).toBeTruthy());
    expect(within(drawer).getByLabelText("Note for 2026-10-28")).toBeTruthy();
  });
});

describe("Next reports", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  const event = (id: string, scheduledAt: string): CalendarEvent => ({ id, kind: "report", scheduledAt, commodity: "ZC", title: id });

  it("orders upcoming reports soonest first, then past ones newest first", () => {
    const now = new Date("2026-11-11T12:00:00Z").getTime();
    const ordered = orderReports([event("past-old", "2026-11-01T12:00:00Z"), event("later", "2026-11-20T12:00:00Z"), event("past-new", "2026-11-10T12:00:00Z"), event("soon", "2026-11-12T12:00:00Z")], now);
    expect(ordered.map((item) => item.id)).toEqual(["soon", "later", "past-new", "past-old"]);
  });

  it("shows five reports, and every one on request", async () => {
    ipc.listCalendarEvents.mockResolvedValue(Array.from({ length: 7 }, (_, index) => event(`Report ${index}`, `2099-01-0${index + 1}T12:00:00Z`)));
    withClient(<CalendarPanel />);
    expect(await screen.findByText("Report 0")).toBeTruthy();
    expect(screen.queryByText("Report 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 7 reports" }));
    expect(screen.getByText("Report 6")).toBeTruthy();
  });
});

describe("price chart clicks", () => {
  it("reads a clicked bar's time as a date, in either form the chart reports", () => {
    expect(timeToDate("2026-10-28")).toBe("2026-10-28");
    expect(timeToDate({ year: 2026, month: 3, day: 7 })).toBe("2026-03-07");
    expect(timeToDate(undefined)).toBeUndefined();
  });
});
