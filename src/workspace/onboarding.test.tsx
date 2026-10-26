// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ saveSecret: vi.fn() }));
const massiveKeyFails = () => ipc.saveSecret.mockImplementation((id: string) => (id === "massive" ? Promise.reject(new Error("keychain locked")) : Promise.resolve()));
vi.mock("@/lib/ipc", () => ipc);

import { Onboarding } from "./onboarding";

describe("Onboarding", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("completes with the chosen role, crops and state without needing any key", async () => {
    const onComplete = vi.fn();
    render(<Onboarding open onComplete={onComplete} onSkip={() => undefined} />);
    fireEvent.click(screen.getByLabelText(/Trader/));
    fireEvent.click(screen.getByLabelText("Soybeans"));
    fireEvent.change(screen.getByLabelText("Home state"), { target: { value: "ne" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ role: "trader", commodities: ["ZC", "ZS"], region: "ne" }));
    expect(ipc.saveSecret).not.toHaveBeenCalled();
  });

  it("requires at least one crop", () => {
    render(<Onboarding open onComplete={() => undefined} onSkip={() => undefined} />);
    fireEvent.click(screen.getByLabelText("Corn"));
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves entered keys and stays open to report a key that failed", async () => {
    massiveKeyFails();
    const onComplete = vi.fn();
    render(<Onboarding open onComplete={onComplete} onSkip={() => undefined} />);
    fireEvent.change(screen.getByLabelText("USDA NASS QuickStats key"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Massive key"), { target: { value: "ms-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Massive (Error: keychain locked)");
    expect(alert.textContent).not.toContain("NASS");
    expect(ipc.saveSecret).toHaveBeenCalledWith("usda-nass", "abc");
    expect(ipc.saveSecret).toHaveBeenCalledWith("massive", "ms-1");
    expect(onComplete).not.toHaveBeenCalled();

    // Trying again retries only the key that failed.
    ipc.saveSecret.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ role: "farmer", commodities: ["ZC"], region: "ia" }));
    expect(ipc.saveSecret.mock.calls.map(([id]) => id)).toEqual(["usda-nass", "massive", "massive"]);
  });

  it("can continue without a key that failed", async () => {
    massiveKeyFails();
    const onComplete = vi.fn();
    render(<Onboarding open onComplete={onComplete} onSkip={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Massive key"), { target: { value: "ms-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue without it" }));
    expect(onComplete).toHaveBeenCalledWith({ role: "farmer", commodities: ["ZC"], region: "ia" });
  });

  it("offers a way to skip", () => {
    const onSkip = vi.fn();
    render(<Onboarding open onComplete={() => undefined} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onSkip).toHaveBeenCalled();
  });
});
